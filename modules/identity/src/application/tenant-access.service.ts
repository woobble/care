import { and, count, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { facilities, organizationsTable, teams } from '@care/organizations';
import {
  can,
  canGrantPermissions,
  PERMISSIONS,
  type AuthorizationPrincipal,
  type Permission,
  type ScopeType,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import {
  activateMembership,
  deactivateMembership,
  MembershipRevokedError,
  revokeMembership,
  transitionInvitation,
} from '@module/identity/domain/membership';
import {
  membershipRoles,
  membershipScopes,
  rolePermissions,
  roles,
  tenantInvitations,
  tenantMemberships,
  users,
} from '@module/identity/schema';

import { loadTenantAuthorizationPrincipal } from './authorization-principal';
import { InvalidAuthorizationConfigurationError } from './identity.service';

export type TenantAdminScopeType = 'tenant' | 'organization' | 'facility' | 'team';

export interface TenantScopeInput {
  scopeType: TenantAdminScopeType;
  scopeId: string;
}

export interface TenantMemberView {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  status: 'pending' | 'active' | 'inactive' | 'revoked';
  roles: Array<{ id: string; name: string; permissions: Permission[] }>;
  scopes: Array<{ scopeType: ScopeType; scopeId: string; name: string | null }>;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantInvitationView {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export class TenantAccessService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async listMembers(
    principal: AuthorizationPrincipal,
    input: { page?: number; pageSize?: number; status?: TenantMemberView['status'] } = {},
  ): Promise<{ items: TenantMemberView[]; page: number; pageSize: number; total: number }> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new TenantAccessError('INVALID_PAGINATION', 400, 'Pagination values are invalid');
    }
    this.requirePermission(principal, 'tenant.members.read', tenantResource(principal.tenantId));

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.setActor(transaction, principal.userId);
      const filters = [eq(tenantMemberships.tenantId, principal.tenantId)];
      if (input.status) filters.push(eq(tenantMemberships.status, input.status));
      const where = and(...filters);
      const rows = await transaction
        .select({
          id: tenantMemberships.id,
          userId: tenantMemberships.userId,
          displayName: users.displayName,
          email: users.email,
          status: tenantMemberships.status,
          createdAt: tenantMemberships.createdAt,
          updatedAt: tenantMemberships.updatedAt,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(tenantMemberships.userId, users.id))
        .where(where)
        .orderBy(desc(tenantMemberships.createdAt), desc(tenantMemberships.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const totals = await transaction
        .select({ total: count() })
        .from(tenantMemberships)
        .where(where);
      return {
        items: await this.memberViews(transaction, principal.tenantId, rows),
        page,
        pageSize,
        total: Number(totals[0]?.total ?? 0),
      };
    });
  }

  async getMember(
    principal: AuthorizationPrincipal,
    membershipId: string,
  ): Promise<TenantMemberView> {
    this.requirePermission(principal, 'tenant.members.read', tenantResource(principal.tenantId));
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.setActor(transaction, principal.userId);
      const [row] = await transaction
        .select({
          id: tenantMemberships.id,
          userId: tenantMemberships.userId,
          displayName: users.displayName,
          email: users.email,
          status: tenantMemberships.status,
          createdAt: tenantMemberships.createdAt,
          updatedAt: tenantMemberships.updatedAt,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(tenantMemberships.userId, users.id))
        .where(
          and(
            eq(tenantMemberships.id, membershipId),
            eq(tenantMemberships.tenantId, principal.tenantId),
          ),
        )
        .limit(1);
      if (!row) throw notFound('MEMBERSHIP_NOT_FOUND', 'Tenant membership was not found');
      return (await this.memberViews(transaction, principal.tenantId, [row]))[0]!;
    });
  }

  async listRoles(
    principal: AuthorizationPrincipal,
  ): Promise<Array<{ id: string; name: string; permissions: Permission[] }>> {
    this.requirePermission(principal, 'tenant.roles.read', tenantResource(principal.tenantId));
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.setActor(transaction, principal.userId);
      const rows = await transaction
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(eq(roles.tenantId, principal.tenantId))
        .orderBy(roles.name);
      const grants = rows.length
        ? await transaction
            .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(
              inArray(
                rolePermissions.roleId,
                rows.map((row) => row.id),
              ),
            )
        : [];
      const permissions = new Map<string, Permission[]>();
      for (const grant of grants) {
        if (!isPermission(grant.permission)) throw new InvalidAuthorizationConfigurationError();
        const list = permissions.get(grant.roleId) ?? [];
        list.push(grant.permission);
        permissions.set(grant.roleId, list);
      }
      return rows.map((role) => ({
        ...role,
        permissions: [...new Set(permissions.get(role.id) ?? [])].sort(),
      }));
    });
  }

  async listInvitationsPage(
    principal: AuthorizationPrincipal,
    input: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: TenantInvitationView[]; page: number; pageSize: number; total: number }> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new TenantAccessError('INVALID_PAGINATION', 400, 'Pagination values are invalid');
    }
    this.requirePermission(principal, 'tenant.members.read', tenantResource(principal.tenantId));
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.setActor(transaction, principal.userId);
      const where = eq(tenantInvitations.tenantId, principal.tenantId);
      const [rows, totals] = await Promise.all([
        transaction
          .select()
          .from(tenantInvitations)
          .where(where)
          .orderBy(desc(tenantInvitations.createdAt), desc(tenantInvitations.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        transaction.select({ total: count() }).from(tenantInvitations).where(where),
      ]);
      return {
        items: rows.map((row) => invitationView(row)),
        page,
        pageSize,
        total: totals[0]?.total ?? 0,
      };
    });
  }

  async invite(
    principal: AuthorizationPrincipal,
    email: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<{ invitation: TenantInvitationView }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail.length > 254 || /\s/.test(normalizedEmail)) {
      throw new TenantAccessError('INVALID_REQUEST', 400, 'Invitation email is invalid');
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const actor = await this.currentActor(transaction, principal);
      this.requirePermission(actor, 'tenant.members.manage', tenantResource(actor.tenantId));
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${actor.tenantId}), hashtext(${normalizedEmail}))`,
      );
      const now = new Date();

      const expired = await transaction
        .update(tenantInvitations)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(tenantInvitations.tenantId, actor.tenantId),
            eq(tenantInvitations.email, normalizedEmail),
            eq(tenantInvitations.status, 'pending'),
            lte(tenantInvitations.expiresAt, now),
          ),
        )
        .returning({ id: tenantInvitations.id });
      const expiredInvitation = expired[0];
      if (expiredInvitation) {
        await this.recordAccessChange(transaction, {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          context,
          request,
          action: 'tenant.invitation.expired',
          resourceType: 'tenant_invitation',
          resourceId: expiredInvitation.id,
          metadata: { invitationId: expiredInvitation.id },
          event: createDomainEvent({
            type: 'tenant.invitation.expired',
            tenantId: actor.tenantId,
            aggregateType: 'tenant_invitation',
            aggregateId: expiredInvitation.id,
            actor: { type: 'user', id: actor.userId },
            correlationId: context.correlationId,
            payload: { invitationId: expiredInvitation.id },
          }),
        });
      }

      const [duplicate] = await transaction
        .select({ id: tenantInvitations.id })
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.tenantId, actor.tenantId),
            eq(tenantInvitations.email, normalizedEmail),
            eq(tenantInvitations.status, 'pending'),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new TenantAccessError(
          'INVITATION_ALREADY_EXISTS',
          409,
          'A pending invitation already exists for this email',
        );
      }

      const matchingUsers = await transaction
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(2);
      if (matchingUsers.length > 1) {
        throw new TenantAccessError(
          'INVITATION_EMAIL_AMBIGUOUS',
          409,
          'The email is associated with more than one platform user',
        );
      }
      const existingUser = matchingUsers[0];
      if (existingUser) {
        if (existingUser.status !== 'active') {
          throw new TenantAccessError('USER_DISABLED', 409, 'The platform user is disabled');
        }
        const [existingMembership] = await transaction
          .select({ status: tenantMemberships.status })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.userId, existingUser.id),
              eq(tenantMemberships.tenantId, actor.tenantId),
            ),
          )
          .limit(1);
        if (existingMembership?.status === 'revoked') throw new MembershipRevokedError();
        if (existingMembership) {
          throw new TenantAccessError('USER_ALREADY_MEMBER', 409, 'The user is already a member');
        }
      }

      const invitationId = uuidv7();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transaction.insert(tenantInvitations).values({
        id: invitationId,
        tenantId: actor.tenantId,
        email: normalizedEmail,
        status: 'pending',
        createdBy: actor.userId,
        expiresAt,
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      await this.recordAccessChange(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        context,
        request,
        action: 'tenant.member.invited',
        resourceType: 'tenant_invitation',
        resourceId: invitationId,
        metadata: { invitationId },
        event: createDomainEvent({
          type: 'tenant.invitation.created',
          tenantId: actor.tenantId,
          aggregateType: 'tenant_invitation',
          aggregateId: invitationId,
          actor: { type: 'user', id: actor.userId },
          correlationId: context.correlationId,
          payload: { invitationId },
        }),
      });

      return {
        invitation: {
          id: invitationId,
          email: normalizedEmail,
          status: 'pending',
          createdBy: actor.userId,
          expiresAt,
          acceptedAt: null,
          createdAt: now,
        },
      };
    });
  }

  async acceptMatchingInvitation(
    userId: string,
    verifiedEmail: string | undefined,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<string[]> {
    if (!verifiedEmail) return [];
    const email = verifiedEmail.trim().toLowerCase();
    if (!email || email.length > 254 || /\s/.test(email)) return [];

    return this.unitOfWork.transaction({}, async (transaction) => {
      await this.setActor(transaction, userId);
      await transaction.execute(sql`select set_config('app.user_email', ${email}, true)`);
      const now = new Date();
      const invitations = await transaction
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.email, email),
            eq(tenantInvitations.status, 'pending'),
            gt(tenantInvitations.expiresAt, now),
          ),
        )
        .for('update');
      const acceptedMemberships: string[] = [];

      // Each row needs a different transaction-local tenant for RLS and its audit/outbox writes.
      // oxlint-disable no-await-in-loop
      for (const invitation of invitations) {
        await transaction.execute(
          sql`select set_config('app.tenant_id', ${invitation.tenantId}, true)`,
        );
        const matchingUsers = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(2);
        if (matchingUsers.length > 1 || matchingUsers[0]?.id !== userId) {
          await this.closeAmbiguousInvitation(
            transaction,
            invitation,
            userId,
            context,
            request,
            now,
          );
          continue;
        }

        const [existingMembership] = await transaction
          .select({ id: tenantMemberships.id, status: tenantMemberships.status })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.userId, userId),
              eq(tenantMemberships.tenantId, invitation.tenantId),
            ),
          )
          .for('update')
          .limit(1);
        if (existingMembership?.status === 'revoked') {
          await transaction
            .update(tenantInvitations)
            .set({ status: 'revoked', updatedAt: now })
            .where(eq(tenantInvitations.id, invitation.id));
          await this.recordAccessChange(transaction, {
            tenantId: invitation.tenantId,
            actorId: userId,
            context,
            request,
            action: 'tenant.invitation.revoked',
            resourceType: 'tenant_invitation',
            resourceId: invitation.id,
            metadata: { invitationId: invitation.id },
            event: createDomainEvent({
              type: 'tenant.invitation.revoked',
              tenantId: invitation.tenantId,
              aggregateType: 'tenant_invitation',
              aggregateId: invitation.id,
              actor: { type: 'user', id: userId },
              correlationId: context.correlationId,
              payload: { invitationId: invitation.id },
            }),
          });
          continue;
        }

        await transaction
          .update(tenantInvitations)
          .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
          .where(eq(tenantInvitations.id, invitation.id));
        if (existingMembership) {
          await this.recordAccessChange(transaction, {
            tenantId: invitation.tenantId,
            actorId: userId,
            context,
            request,
            action: 'tenant.invitation.accepted',
            resourceType: 'tenant_invitation',
            resourceId: invitation.id,
            metadata: { invitationId: invitation.id, existingMembershipId: existingMembership.id },
            event: createDomainEvent({
              type: 'tenant.invitation.accepted',
              tenantId: invitation.tenantId,
              aggregateType: 'tenant_invitation',
              aggregateId: invitation.id,
              actor: { type: 'user', id: userId },
              correlationId: context.correlationId,
              payload: { invitationId: invitation.id, membershipId: existingMembership.id },
            }),
          });
          continue;
        }

        const membershipId = uuidv7();
        await transaction.insert(tenantMemberships).values({
          id: membershipId,
          userId,
          tenantId: invitation.tenantId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(membershipScopes).values({
          membershipId,
          tenantId: invitation.tenantId,
          scopeType: 'tenant',
          scopeId: invitation.tenantId,
        });
        acceptedMemberships.push(membershipId);
        await this.recordAccessChange(transaction, {
          tenantId: invitation.tenantId,
          actorId: userId,
          context,
          request,
          action: 'tenant.invitation.accepted',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
          metadata: { invitationId: invitation.id, membershipId },
          event: createDomainEvent({
            type: 'tenant.invitation.accepted',
            tenantId: invitation.tenantId,
            aggregateType: 'tenant_invitation',
            aggregateId: invitation.id,
            actor: { type: 'user', id: userId },
            correlationId: context.correlationId,
            payload: { invitationId: invitation.id, membershipId },
          }),
        });
      }
      // oxlint-enable no-await-in-loop
      return acceptedMemberships;
    });
  }

  async activate(
    principal: AuthorizationPrincipal,
    membershipId: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantMemberView> {
    await this.changeMembershipStatus(principal, membershipId, 'activate', context, request);
    return this.getMember(principal, membershipId);
  }

  async deactivate(
    principal: AuthorizationPrincipal,
    membershipId: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantMemberView> {
    await this.changeMembershipStatus(principal, membershipId, 'deactivate', context, request);
    return this.getMember(principal, membershipId);
  }

  async revoke(
    principal: AuthorizationPrincipal,
    membershipId: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantMemberView> {
    await this.changeMembershipStatus(principal, membershipId, 'revoke', context, request);
    return this.getMember(principal, membershipId);
  }

  async replaceRoles(
    principal: AuthorizationPrincipal,
    membershipId: string,
    roleIds: readonly string[],
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantMemberView> {
    const desiredRoleIds = [...new Set(roleIds)].sort();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const actor = await this.currentActor(transaction, principal);
      this.requirePermission(actor, 'tenant.members.manage', tenantResource(actor.tenantId));
      const membership = await this.lockMember(transaction, actor.tenantId, membershipId);
      if (membership.status === 'revoked') throw new MembershipRevokedError();

      const scopes = await this.scopesForMember(transaction, actor.tenantId, membershipId);
      const roleRows = desiredRoleIds.length
        ? await transaction
            .select({ id: roles.id, name: roles.name })
            .from(roles)
            .where(and(eq(roles.tenantId, actor.tenantId), inArray(roles.id, desiredRoleIds)))
        : [];
      if (roleRows.length !== desiredRoleIds.length) {
        throw notFound('ROLE_NOT_FOUND', 'One or more roles were not found in this tenant');
      }
      const permissionRows = desiredRoleIds.length
        ? await transaction
            .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(inArray(rolePermissions.roleId, desiredRoleIds))
        : [];
      const rolePermissionsById = new Map<string, Permission[]>();
      for (const row of permissionRows) {
        if (!isPermission(row.permission)) throw new InvalidAuthorizationConfigurationError();
        const list = rolePermissionsById.get(row.roleId) ?? [];
        list.push(row.permission);
        rolePermissionsById.set(row.roleId, list);
      }
      if (roleRows.length > 0 && scopes.length === 0) {
        throw new TenantAccessError('INVALID_SCOPE', 400, 'A role needs at least one access scope');
      }
      const resources = await this.resourcesForScopes(transaction, actor.tenantId, scopes);
      for (const resource of resources) {
        for (const roleId of desiredRoleIds) {
          if (!canGrantPermissions(actor, rolePermissionsById.get(roleId) ?? [], resource)) {
            throw new TenantAccessError(
              'ROLE_NOT_ASSIGNABLE',
              403,
              'The actor cannot grant all permissions in this role at the selected scope',
            );
          }
        }
      }

      const current = await transaction
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, membershipId));
      const currentRoleIds = current.map((row) => row.roleId).sort();
      const addedRoleIds = desiredRoleIds.filter((id) => !currentRoleIds.includes(id));
      const removedRoleIds = currentRoleIds.filter((id) => !desiredRoleIds.includes(id));
      if (addedRoleIds.length === 0 && removedRoleIds.length === 0) {
        return (await this.memberViews(transaction, actor.tenantId, [membership]))[0]!;
      }
      if (removedRoleIds.length) {
        await transaction
          .delete(membershipRoles)
          .where(
            and(
              eq(membershipRoles.membershipId, membershipId),
              inArray(membershipRoles.roleId, removedRoleIds),
            ),
          );
      }
      if (addedRoleIds.length) {
        await transaction.insert(membershipRoles).values(
          addedRoleIds.map((roleId) => ({
            membershipId,
            tenantId: actor.tenantId,
            roleId,
          })),
        );
      }
      await this.recordAccessChange(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        context,
        request,
        action: 'tenant.member.role_changed',
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        metadata: { membershipId, addedRoleIds, removedRoleIds },
        event: createDomainEvent({
          type: 'tenant.member.role_changed',
          tenantId: actor.tenantId,
          aggregateType: 'tenant_membership',
          aggregateId: membershipId,
          actor: { type: 'user', id: actor.userId },
          correlationId: context.correlationId,
          payload: { membershipId, addedRoleIds, removedRoleIds },
        }),
      });
      return (await this.memberViews(transaction, actor.tenantId, [membership]))[0]!;
    });
  }

  async replaceScopes(
    principal: AuthorizationPrincipal,
    membershipId: string,
    input: readonly TenantScopeInput[],
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantMemberView> {
    const desired = deduplicateScopes(input);
    if (desired.some((scope) => scope.scopeType === 'tenant') && desired.length > 1) {
      throw new TenantAccessError(
        'INVALID_SCOPE',
        400,
        'Tenant scope cannot be combined with narrower scopes',
      );
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const actor = await this.currentActor(transaction, principal);
      this.requirePermission(actor, 'tenant.members.manage', tenantResource(actor.tenantId));
      const membership = await this.lockMember(transaction, actor.tenantId, membershipId);
      if (membership.status === 'revoked') throw new MembershipRevokedError();
      const resources = await this.resourcesForScopes(transaction, actor.tenantId, desired);

      const roleRows = await transaction
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, membershipId));
      const permissions = roleRows.length
        ? await transaction
            .select({ permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(
              inArray(
                rolePermissions.roleId,
                roleRows.map((row) => row.roleId),
              ),
            )
        : [];
      const effectivePermissions = [...new Set(permissions.map((row) => row.permission))].map(
        requirePermissionName,
      );
      for (const resource of resources) {
        this.requirePermission(actor, 'tenant.members.manage', resource);
        if (
          effectivePermissions.some((permission) => !can(actor, { action: permission, resource }))
        ) {
          throw new TenantAccessError(
            'ROLE_NOT_ASSIGNABLE',
            403,
            'The actor cannot grant all membership permissions at the selected scope',
          );
        }
      }

      const current = await this.scopesForMember(transaction, actor.tenantId, membershipId);
      const currentKeys = new Set(current.map(scopeKey));
      const desiredKeys = new Set(desired.map(scopeKey));
      const added = desired.filter((scope) => !currentKeys.has(scopeKey(scope)));
      const removed = current.filter((scope) => !desiredKeys.has(scopeKey(scope)));
      if (added.length === 0 && removed.length === 0) {
        return (await this.memberViews(transaction, actor.tenantId, [membership]))[0]!;
      }
      if (removed.length) {
        await transaction
          .delete(membershipScopes)
          .where(
            and(
              eq(membershipScopes.membershipId, membershipId),
              or(
                ...removed.map((scope) =>
                  and(
                    eq(membershipScopes.scopeType, scope.scopeType),
                    eq(membershipScopes.scopeId, scope.scopeId),
                  ),
                ),
              ),
            ),
          );
      }
      if (added.length) {
        await transaction.insert(membershipScopes).values(
          added.map((scope) => ({
            membershipId,
            tenantId: actor.tenantId,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        );
      }
      await this.recordAccessChange(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        context,
        request,
        action: 'tenant.member.scope_changed',
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        metadata: {
          membershipId,
          addedScopes: added.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
          removedScopes: removed.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
        },
        event: createDomainEvent({
          type: 'tenant.member.scope_changed',
          tenantId: actor.tenantId,
          aggregateType: 'tenant_membership',
          aggregateId: membershipId,
          actor: { type: 'user', id: actor.userId },
          correlationId: context.correlationId,
          payload: {
            membershipId,
            addedScopes: added.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
            removedScopes: removed.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
          },
        }),
      });
      return (await this.memberViews(transaction, actor.tenantId, [membership]))[0]!;
    });
  }

  async revokeInvitation(
    principal: AuthorizationPrincipal,
    invitationId: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<TenantInvitationView> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const actor = await this.currentActor(transaction, principal);
      this.requirePermission(actor, 'tenant.members.manage', tenantResource(actor.tenantId));
      const [invitation] = await transaction
        .select()
        .from(tenantInvitations)
        .where(
          and(
            eq(tenantInvitations.id, invitationId),
            eq(tenantInvitations.tenantId, actor.tenantId),
          ),
        )
        .for('update')
        .limit(1);
      if (!invitation) throw notFound('INVITATION_NOT_FOUND', 'Invitation was not found');
      if (invitation.status !== 'pending') {
        if (invitation.status === 'accepted') {
          throw new TenantAccessError(
            'INVITATION_NOT_PENDING',
            409,
            'Invitation was already accepted',
          );
        }
        return invitationView(invitation);
      }
      const nextStatus =
        invitation.expiresAt <= new Date()
          ? transitionInvitation(invitation.status, 'expired')
          : transitionInvitation(invitation.status, 'revoked');
      const now = new Date();
      const [updated] = await transaction
        .update(tenantInvitations)
        .set({ status: nextStatus, updatedAt: now })
        .where(eq(tenantInvitations.id, invitationId))
        .returning();
      const expired = nextStatus === 'expired';
      await this.recordAccessChange(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        context,
        request,
        action: expired ? 'tenant.invitation.expired' : 'tenant.invitation.revoked',
        resourceType: 'tenant_invitation',
        resourceId: invitationId,
        metadata: { invitationId },
        event: expired
          ? createDomainEvent({
              type: 'tenant.invitation.expired',
              tenantId: actor.tenantId,
              aggregateType: 'tenant_invitation',
              aggregateId: invitationId,
              actor: { type: 'user', id: actor.userId },
              correlationId: context.correlationId,
              payload: { invitationId },
            })
          : createDomainEvent({
              type: 'tenant.invitation.revoked',
              tenantId: actor.tenantId,
              aggregateType: 'tenant_invitation',
              aggregateId: invitationId,
              actor: { type: 'user', id: actor.userId },
              correlationId: context.correlationId,
              payload: { invitationId },
            }),
      });
      return invitationView(updated!);
    });
  }

  private async changeMembershipStatus(
    principal: AuthorizationPrincipal,
    membershipId: string,
    operation: 'activate' | 'deactivate' | 'revoke',
    context: RequestContext,
    request: { ip?: string; userAgent?: string },
  ): Promise<void> {
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const actor = await this.currentActor(transaction, principal);
      this.requirePermission(actor, 'tenant.members.manage', tenantResource(actor.tenantId));
      const membership = await this.lockMember(transaction, actor.tenantId, membershipId);
      const nextStatus =
        operation === 'activate'
          ? activateMembership(membership.status)
          : operation === 'deactivate'
            ? deactivateMembership(membership.status)
            : revokeMembership(membership.status);
      const now = new Date();
      await transaction
        .update(tenantMemberships)
        .set({ status: nextStatus, updatedAt: now })
        .where(
          and(
            eq(tenantMemberships.id, membershipId),
            eq(tenantMemberships.tenantId, actor.tenantId),
          ),
        );
      const eventType =
        operation === 'activate'
          ? 'tenant.member.activated'
          : operation === 'deactivate'
            ? 'tenant.member.deactivated'
            : 'tenant.member.revoked';
      const auditAction = eventType;
      await this.recordAccessChange(transaction, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        context,
        request,
        action: auditAction,
        resourceType: 'tenant_membership',
        resourceId: membershipId,
        metadata: { membershipId, status: nextStatus },
        event:
          operation === 'activate'
            ? createDomainEvent({
                type: 'tenant.member.activated',
                tenantId: actor.tenantId,
                aggregateType: 'tenant_membership',
                aggregateId: membershipId,
                actor: { type: 'user', id: actor.userId },
                correlationId: context.correlationId,
                payload: { membershipId },
              })
            : operation === 'deactivate'
              ? createDomainEvent({
                  type: 'tenant.member.deactivated',
                  tenantId: actor.tenantId,
                  aggregateType: 'tenant_membership',
                  aggregateId: membershipId,
                  actor: { type: 'user', id: actor.userId },
                  correlationId: context.correlationId,
                  payload: { membershipId },
                })
              : createDomainEvent({
                  type: 'tenant.member.revoked',
                  tenantId: actor.tenantId,
                  aggregateType: 'tenant_membership',
                  aggregateId: membershipId,
                  actor: { type: 'user', id: actor.userId },
                  correlationId: context.correlationId,
                  payload: { membershipId },
                }),
      });
    });
  }

  private async currentActor(
    transaction: DatabaseTransaction,
    supplied: AuthorizationPrincipal,
  ): Promise<AuthorizationPrincipal> {
    await this.setActor(transaction, supplied.userId);
    return loadTenantAuthorizationPrincipal(transaction, supplied.userId, supplied.tenantId, {
      lockMembership: true,
    });
  }

  private async setActor(transaction: DatabaseTransaction, userId: string): Promise<void> {
    await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  }

  private async lockMember(
    transaction: DatabaseTransaction,
    tenantId: string,
    membershipId: string,
  ) {
    const [membership] = await transaction
      .select({
        id: tenantMemberships.id,
        userId: tenantMemberships.userId,
        displayName: users.displayName,
        email: users.email,
        status: tenantMemberships.status,
        createdAt: tenantMemberships.createdAt,
        updatedAt: tenantMemberships.updatedAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(tenantMemberships.userId, users.id))
      .where(and(eq(tenantMemberships.id, membershipId), eq(tenantMemberships.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!membership) throw notFound('MEMBERSHIP_NOT_FOUND', 'Tenant membership was not found');
    return membership;
  }

  private async scopesForMember(
    transaction: DatabaseTransaction,
    tenantId: string,
    membershipId: string,
  ) {
    return transaction
      .select({
        scopeType: membershipScopes.scopeType,
        scopeId: membershipScopes.scopeId,
        organizationName: organizationsTable.name,
        facilityName: facilities.name,
        teamName: teams.name,
        facilityOrganizationId: facilities.organizationId,
      })
      .from(membershipScopes)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.id, membershipScopes.scopeId),
          eq(organizationsTable.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'organization'),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, membershipScopes.scopeId),
          eq(facilities.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'facility'),
        ),
      )
      .leftJoin(
        teams,
        and(
          eq(teams.id, membershipScopes.scopeId),
          eq(teams.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'team'),
        ),
      )
      .where(
        and(
          eq(membershipScopes.membershipId, membershipId),
          eq(membershipScopes.tenantId, tenantId),
        ),
      );
  }

  private async memberViews(
    transaction: DatabaseTransaction,
    tenantId: string,
    members: Array<{
      id: string;
      userId: string;
      displayName: string | null;
      email: string | null;
      status: TenantMemberView['status'];
      createdAt: Date;
      updatedAt: Date;
    }>,
  ): Promise<TenantMemberView[]> {
    if (members.length === 0) return [];
    const ids = members.map((member) => member.id);
    const memberRoleRows = await transaction
      .select({
        membershipId: membershipRoles.membershipId,
        roleId: roles.id,
        roleName: roles.name,
      })
      .from(membershipRoles)
      .innerJoin(
        roles,
        and(
          eq(roles.id, membershipRoles.roleId),
          eq(roles.tenantId, tenantId),
          eq(membershipRoles.tenantId, tenantId),
        ),
      )
      .where(inArray(membershipRoles.membershipId, ids));
    const permissionRows = await transaction
      .select({
        membershipId: membershipRoles.membershipId,
        roleId: membershipRoles.roleId,
        permission: rolePermissions.permission,
      })
      .from(membershipRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
      .where(
        and(inArray(membershipRoles.membershipId, ids), eq(membershipRoles.tenantId, tenantId)),
      );
    const scopeRows = await transaction
      .select({
        membershipId: membershipScopes.membershipId,
        scopeType: membershipScopes.scopeType,
        scopeId: membershipScopes.scopeId,
        organizationName: organizationsTable.name,
        facilityName: facilities.name,
        teamName: teams.name,
      })
      .from(membershipScopes)
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.id, membershipScopes.scopeId),
          eq(organizationsTable.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'organization'),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, membershipScopes.scopeId),
          eq(facilities.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'facility'),
        ),
      )
      .leftJoin(
        teams,
        and(
          eq(teams.id, membershipScopes.scopeId),
          eq(teams.tenantId, tenantId),
          eq(membershipScopes.scopeType, 'team'),
        ),
      )
      .where(
        and(inArray(membershipScopes.membershipId, ids), eq(membershipScopes.tenantId, tenantId)),
      );

    const roleMap = new Map<
      string,
      Map<string, { id: string; name: string; permissions: Permission[] }>
    >();
    for (const row of memberRoleRows) {
      const rolesForMember = roleMap.get(row.membershipId) ?? new Map();
      rolesForMember.set(row.roleId, { id: row.roleId, name: row.roleName, permissions: [] });
      roleMap.set(row.membershipId, rolesForMember);
    }
    const permissionMap = new Map<string, Permission[]>();
    for (const row of permissionRows) {
      if (!isPermission(row.permission)) throw new InvalidAuthorizationConfigurationError();
      const key = `${row.membershipId}:${row.roleId}`;
      const list = permissionMap.get(key) ?? [];
      list.push(row.permission);
      permissionMap.set(key, list);
    }
    const scopesMap = new Map<string, TenantMemberView['scopes']>();
    for (const row of scopeRows) {
      if (!isScopeType(row.scopeType)) throw new InvalidAuthorizationConfigurationError();
      const list = scopesMap.get(row.membershipId) ?? [];
      list.push({
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        name:
          row.teamName ??
          row.facilityName ??
          row.organizationName ??
          (row.scopeType === 'tenant' ? 'Entire tenant' : null),
      });
      scopesMap.set(row.membershipId, list);
    }

    return members.map((member) => {
      const rolesForMember = [...(roleMap.get(member.id)?.values() ?? [])].map((role) => ({
        ...role,
        permissions: [...new Set(permissionMap.get(`${member.id}:${role.id}`) ?? [])].sort(),
      }));
      const effectivePermissions = [...new Set(rolesForMember.flatMap((role) => role.permissions))];
      return {
        ...member,
        roles: rolesForMember,
        scopes: scopesMap.get(member.id) ?? [],
        permissions: effectivePermissions.sort(),
      };
    });
  }

  private async resourcesForScopes(
    transaction: DatabaseTransaction,
    tenantId: string,
    scopes: readonly { scopeType: string; scopeId: string }[],
  ): Promise<
    Array<{ tenantId: string; organizationId?: string; facilityId?: string; teamId?: string }>
  > {
    if (
      scopes.some(
        (scope) =>
          scope.scopeType !== 'tenant' &&
          scope.scopeType !== 'organization' &&
          scope.scopeType !== 'facility' &&
          scope.scopeType !== 'team',
      )
    ) {
      throw new TenantAccessError(
        'INVALID_SCOPE',
        400,
        'Assigned-client scopes are not available for administration yet',
      );
    }
    const organizationIds = [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === 'organization').map((scope) => scope.scopeId),
      ),
    ];
    const facilityIds = [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === 'facility').map((scope) => scope.scopeId),
      ),
    ];
    const teamIds = [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === 'team').map((scope) => scope.scopeId),
      ),
    ];
    const organizationRows = organizationIds.length
      ? await transaction
          .select({ id: organizationsTable.id })
          .from(organizationsTable)
          .where(
            and(
              eq(organizationsTable.tenantId, tenantId),
              inArray(organizationsTable.id, organizationIds),
            ),
          )
      : [];
    const facilityRows = facilityIds.length
      ? await transaction
          .select({ id: facilities.id, organizationId: facilities.organizationId })
          .from(facilities)
          .where(and(eq(facilities.tenantId, tenantId), inArray(facilities.id, facilityIds)))
      : [];
    const teamRows = teamIds.length
      ? await transaction
          .select({
            id: teams.id,
            organizationId: teams.organizationId,
            facilityId: teams.facilityId,
          })
          .from(teams)
          .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds)))
      : [];
    if (
      organizationRows.length !== organizationIds.length ||
      facilityRows.length !== facilityIds.length ||
      teamRows.length !== teamIds.length
    ) {
      throw new TenantAccessError(
        'CROSS_TENANT_REFERENCE',
        400,
        'Scope target does not belong to this tenant',
      );
    }
    const facilityOrganizationById = new Map(
      facilityRows.map((facility) => [facility.id, facility.organizationId]),
    );
    const teamById = new Map(teamRows.map((team) => [team.id, team]));
    return scopes.map((scope) => {
      if (scope.scopeType === 'tenant') {
        if (scope.scopeId !== tenantId) {
          throw new TenantAccessError('CROSS_TENANT_REFERENCE', 400, 'Tenant scope is invalid');
        }
        return tenantResource(tenantId);
      }
      if (scope.scopeType === 'organization') return { tenantId, organizationId: scope.scopeId };
      if (scope.scopeType === 'team') {
        const team = teamById.get(scope.scopeId);
        if (!team) {
          throw new TenantAccessError('CROSS_TENANT_REFERENCE', 400, 'Team scope is invalid');
        }
        return {
          tenantId,
          organizationId: team.organizationId,
          ...(team.facilityId ? { facilityId: team.facilityId } : {}),
          teamId: team.id,
        };
      }
      const organizationId = facilityOrganizationById.get(scope.scopeId);
      if (!organizationId) {
        throw new TenantAccessError('CROSS_TENANT_REFERENCE', 400, 'Facility scope is invalid');
      }
      return { tenantId, facilityId: scope.scopeId, organizationId };
    });
  }

  private requirePermission(
    principal: AuthorizationPrincipal,
    permission: Permission,
    resource: {
      tenantId: string;
      organizationId?: string;
      facilityId?: string;
      teamId?: string;
    },
  ): void {
    if (!can(principal, { action: permission, resource })) {
      throw new TenantAccessError(
        'INSUFFICIENT_PERMISSION',
        403,
        'The actor does not have the required permission',
      );
    }
  }

  private async recordAccessChange(
    transaction: DatabaseTransaction,
    input: {
      tenantId: string;
      actorId: string;
      context: RequestContext;
      request: { ip?: string; userAgent?: string };
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
      event: DomainEvent;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(),
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.request.ip ? { ip: input.request.ip } : {}),
      ...(input.request.userAgent ? { userAgent: input.request.userAgent } : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }

  private async closeAmbiguousInvitation(
    transaction: DatabaseTransaction,
    invitation: typeof tenantInvitations.$inferSelect,
    actorId: string,
    context: RequestContext,
    request: { ip?: string; userAgent?: string },
    now: Date,
  ): Promise<void> {
    await transaction
      .update(tenantInvitations)
      .set({ status: 'revoked', updatedAt: now })
      .where(eq(tenantInvitations.id, invitation.id));
    await this.recordAccessChange(transaction, {
      tenantId: invitation.tenantId,
      actorId,
      context,
      request,
      action: 'tenant.invitation.revoked',
      resourceType: 'tenant_invitation',
      resourceId: invitation.id,
      metadata: { invitationId: invitation.id, reason: 'email_identity_mismatch' },
      event: createDomainEvent({
        type: 'tenant.invitation.revoked',
        tenantId: invitation.tenantId,
        aggregateType: 'tenant_invitation',
        aggregateId: invitation.id,
        actor: { type: 'user', id: actorId },
        correlationId: context.correlationId,
        payload: { invitationId: invitation.id },
      }),
    });
  }
}

export class TenantAccessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TenantAccessError';
  }
}

function tenantResource(tenantId: string) {
  return { tenantId };
}

function notFound(code: string, message: string): TenantAccessError {
  return new TenantAccessError(code, 404, message);
}

function invitationView(invitation: typeof tenantInvitations.$inferSelect): TenantInvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    status:
      invitation.status === 'pending' && invitation.expiresAt <= new Date()
        ? 'expired'
        : invitation.status,
    createdBy: invitation.createdBy,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
  };
}

function deduplicateScopes(input: readonly TenantScopeInput[]): TenantScopeInput[] {
  const seen = new Set<string>();
  const result: TenantScopeInput[] = [];
  for (const scope of input) {
    const key = scopeKey(scope);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(scope);
  }
  return result;
}

function scopeKey(scope: { scopeType: string; scopeId: string }): string {
  return `${scope.scopeType}:${scope.scopeId}`;
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

function requirePermissionName(value: string): Permission {
  if (!isPermission(value)) throw new InvalidAuthorizationConfigurationError();
  return value;
}

function isScopeType(value: string): value is ScopeType {
  return ['assigned_clients', 'team', 'facility', 'organization', 'tenant'].includes(value);
}
