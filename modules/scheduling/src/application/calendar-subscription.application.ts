import { createHash, randomBytes } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { identitySchema } from '@care/identity';
import { can, type AuthorizationPrincipal } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';

import {
  CalendarSubscriptionRepository,
  type CalendarFeedRow,
} from '../infrastructure/calendar-subscription.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
export const CALENDAR_FEED_HISTORY_DAYS = 90;
export const CALENDAR_FEED_FUTURE_DAYS = 365;

type AuditContext = { ip?: string; userAgent?: string };

export type CalendarSubscriptionReference = {
  tenantId: string;
  subscriptionId: string;
  userId: string;
  employeeId: string;
  tokenHash: string;
};

export type CalendarFeedEvent = {
  uid: string;
  status: 'planned' | 'confirmed' | 'cancelled';
  plannedStart: Date;
  plannedEnd: Date;
  createdAt: Date;
  updatedAt: Date;
};

export class CalendarSubscriptionPermissionError extends Error {
  constructor() {
    super('An active caregiver employee link is required');
    this.name = 'CalendarSubscriptionPermissionError';
  }
}

export class CalendarSubscriptionUnavailableError extends Error {
  constructor() {
    super('Calendar subscription is unavailable');
    this.name = 'CalendarSubscriptionUnavailableError';
  }
}

export class CalendarSubscriptionApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly repository = new CalendarSubscriptionRepository(),
  ) {}

  async getStatus(principal: AuthorizationPrincipal) {
    this.requireCaregiverPrincipal(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireLinkedEmployee(transaction, principal);
      return this.repository.activeSubscriptionForEmployee(
        transaction,
        principal.tenantId,
        employee.id,
        principal.userId,
      );
    });
  }

  async rotate(
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<{ tenantId: string; token: string; createdAt: Date }> {
    this.requireCaregiverPrincipal(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireLinkedEmployee(transaction, principal, true);
      const now = new Date();
      const revoked = await this.repository.revokeActiveForEmployee(transaction, {
        tenantId: principal.tenantId,
        employeeId: employee.id,
        revokedAt: now,
      });
      for (const previous of revoked) {
        // oxlint-disable-next-line no-await-in-loop -- Persist each audit and outbox pair in order within this transaction.
        await this.recordSubscriptionEvent(
          transaction,
          principal,
          context,
          auditContext,
          'revoked',
          employee.id,
          previous.id,
          now,
        );
      }

      const token = randomBytes(32).toString('base64url');
      const subscriptionId = uuidv7();
      await this.repository.insert(transaction, {
        id: subscriptionId,
        tenantId: principal.tenantId,
        employeeId: employee.id,
        userId: principal.userId,
        tokenHash: hashToken(token),
        createdAt: now,
        revokedAt: null,
      });
      await this.recordSubscriptionEvent(
        transaction,
        principal,
        context,
        auditContext,
        'created',
        employee.id,
        subscriptionId,
        now,
      );
      return { tenantId: principal.tenantId, token, createdAt: now };
    });
  }

  async revoke(
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
  ): Promise<boolean> {
    this.requireCaregiverPrincipal(principal);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const employee = await this.requireLinkedEmployee(transaction, principal, true);
      const now = new Date();
      const revoked = await this.repository.revokeActiveForEmployee(transaction, {
        tenantId: principal.tenantId,
        employeeId: employee.id,
        revokedAt: now,
      });
      for (const subscription of revoked) {
        // oxlint-disable-next-line no-await-in-loop -- Persist each audit and outbox pair in order within this transaction.
        await this.recordSubscriptionEvent(
          transaction,
          principal,
          context,
          auditContext,
          'revoked',
          employee.id,
          subscription.id,
          now,
        );
      }
      return revoked.length > 0;
    });
  }

  async findToken(tenantId: string, token: string): Promise<CalendarSubscriptionReference | null> {
    if (!isUuid(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      const subscription = await this.repository.findActiveTokenHash(
        transaction,
        tenantId,
        hashToken(token),
      );
      return subscription
        ? {
            tenantId,
            subscriptionId: subscription.id,
            userId: subscription.userId,
            employeeId: subscription.employeeId,
            tokenHash: hashToken(token),
          }
        : null;
    });
  }

  async calendarEvents(
    principal: AuthorizationPrincipal,
    reference: CalendarSubscriptionReference,
    now = new Date(),
  ): Promise<CalendarFeedEvent[]> {
    if (
      principal.tenantId !== reference.tenantId ||
      principal.userId !== reference.userId ||
      !principal.roles?.includes('Caregiver')
    ) {
      throw new CalendarSubscriptionUnavailableError();
    }
    return this.unitOfWork.transaction({ tenantId: reference.tenantId }, async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${principal.userId}, true)`);
      const subscription = await this.repository.activeSubscription(transaction, reference);
      const employee = await this.requireLinkedEmployee(transaction, principal);
      if (!subscription || employee.id !== reference.employeeId) {
        throw new CalendarSubscriptionUnavailableError();
      }
      await this.requireCurrentCaregiverMembership(transaction, principal);

      const rows = await this.repository.calendarEventsForEmployee(transaction, {
        tenantId: reference.tenantId,
        employeeId: reference.employeeId,
        from: new Date(now.getTime() - CALENDAR_FEED_HISTORY_DAYS * DAY_MS),
        until: new Date(now.getTime() + CALENDAR_FEED_FUTURE_DAYS * DAY_MS),
      });
      const teamRows = await this.repository.teamIdsForVisits(
        transaction,
        reference.tenantId,
        rows.map((row) => row.visitId),
      );
      const teamsByVisit = new Map<string, string[]>();
      for (const row of teamRows) {
        const teamIds = teamsByVisit.get(row.visitId) ?? [];
        teamIds.push(row.teamId);
        teamsByVisit.set(row.visitId, teamIds);
      }
      return rows.flatMap((row) => {
        if (!this.canReadCalendarEvent(principal, row, teamsByVisit.get(row.visitId) ?? [])) {
          return [];
        }
        return [calendarFeedEvent(row)];
      });
    });
  }

  private async requireLinkedEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    lock = false,
  ) {
    const employee = await this.repository.employeeForUser(
      transaction,
      principal.tenantId,
      principal.userId,
      lock,
    );
    if (!employee || employee.status !== 'active') throw new CalendarSubscriptionPermissionError();
    return employee;
  }

  private async requireCurrentCaregiverMembership(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ): Promise<void> {
    const rows = await transaction
      .select({ permission: identitySchema.rolePermissions.permission })
      .from(identitySchema.tenantMemberships)
      .innerJoin(
        identitySchema.users,
        eq(identitySchema.users.id, identitySchema.tenantMemberships.userId),
      )
      .innerJoin(
        identitySchema.membershipRoles,
        and(
          eq(identitySchema.membershipRoles.membershipId, identitySchema.tenantMemberships.id),
          eq(identitySchema.membershipRoles.tenantId, principal.tenantId),
        ),
      )
      .innerJoin(
        identitySchema.roles,
        and(
          eq(identitySchema.roles.id, identitySchema.membershipRoles.roleId),
          eq(identitySchema.roles.tenantId, principal.tenantId),
          eq(identitySchema.roles.name, 'Caregiver'),
        ),
      )
      .innerJoin(
        identitySchema.rolePermissions,
        eq(identitySchema.rolePermissions.roleId, identitySchema.roles.id),
      )
      .where(
        and(
          eq(identitySchema.tenantMemberships.tenantId, principal.tenantId),
          eq(identitySchema.tenantMemberships.userId, principal.userId),
          eq(identitySchema.tenantMemberships.status, 'active'),
          eq(identitySchema.users.status, 'active'),
          inArray(identitySchema.rolePermissions.permission, [
            'schedule.read',
            'visit_execution.read',
          ]),
        ),
      );
    const currentPermissions = new Set(rows.map((row) => row.permission));
    if (
      !currentPermissions.has('schedule.read') ||
      !currentPermissions.has('visit_execution.read')
    ) {
      throw new CalendarSubscriptionUnavailableError();
    }
  }

  private requireCaregiverPrincipal(principal: AuthorizationPrincipal): void {
    if (
      !principal.roles?.includes('Caregiver') ||
      !principal.grants.some((grant) => grant.permission === 'schedule.read') ||
      !principal.grants.some((grant) => grant.permission === 'visit_execution.read')
    ) {
      throw new CalendarSubscriptionPermissionError();
    }
  }

  private canReadCalendarEvent(
    principal: AuthorizationPrincipal,
    row: CalendarFeedRow,
    teamIds: string[],
  ): boolean {
    return can(principal, {
      action: 'visit_execution.read',
      resource: {
        tenantId: row.tenantId,
        clientId: row.clientId,
        organizationId: row.organizationId,
        facilityId: row.facilityId,
        teamIds,
      },
    });
  }

  private async recordSubscriptionEvent(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    operation: 'created' | 'revoked',
    employeeId: string,
    subscriptionId: string,
    now: Date,
  ): Promise<void> {
    const event = createDomainEvent({
      type: `scheduling.calendar_subscription_${operation}`,
      tenantId: principal.tenantId,
      aggregateType: 'employee',
      aggregateId: employeeId,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      occurredAt: now.toISOString(),
      payload: { employeeId, subscriptionId },
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: `calendar_subscription.${operation}`,
      resourceType: 'calendar_subscription',
      resourceId: subscriptionId,
      timestamp: now,
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(auditContext.ip ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent ? { userAgent: auditContext.userAgent } : {}),
      metadata: { employeeId, subscriptionId, operation },
    });
    await this.outbox.enqueue(transaction, event);
  }
}

function calendarFeedEvent(row: CalendarFeedRow): CalendarFeedEvent {
  return {
    uid: `${row.visitId}@calendar.care-platform.invalid`,
    status: row.status === 'cancelled' || !row.currentlyAssigned ? 'cancelled' : row.status,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
