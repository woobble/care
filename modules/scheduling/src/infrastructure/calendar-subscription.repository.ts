import { and, asc, eq, exists, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';
import { employeeTeamMemberships, employeeRecords } from '@care/employees';

import { calendarSubscriptions, visitAssignments, visits } from '../schema';

export type CalendarFeedRow = {
  visitId: string;
  clientId: string;
  tenantId: string;
  organizationId: string;
  facilityId: string;
  status: 'planned' | 'confirmed' | 'cancelled';
  plannedStart: Date;
  plannedEnd: Date;
  createdAt: Date;
  updatedAt: Date;
  currentlyAssigned: boolean;
};

export class CalendarSubscriptionRepository {
  async employeeForUser(
    transaction: DatabaseTransaction,
    tenantId: string,
    userId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, tenantId), eq(employeeRecords.userId, userId)));
    const [employee] = lock ? await query.for('update').limit(1) : await query.limit(1);
    return employee ?? null;
  }

  async activeSubscriptionForEmployee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    userId: string,
  ) {
    const [subscription] = await transaction
      .select({ id: calendarSubscriptions.id, createdAt: calendarSubscriptions.createdAt })
      .from(calendarSubscriptions)
      .where(
        and(
          eq(calendarSubscriptions.tenantId, tenantId),
          eq(calendarSubscriptions.employeeId, employeeId),
          eq(calendarSubscriptions.userId, userId),
          isNull(calendarSubscriptions.revokedAt),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  async findActiveTokenHash(transaction: DatabaseTransaction, tenantId: string, tokenHash: string) {
    const [subscription] = await transaction
      .select({
        id: calendarSubscriptions.id,
        userId: calendarSubscriptions.userId,
        employeeId: calendarSubscriptions.employeeId,
      })
      .from(calendarSubscriptions)
      .where(
        and(
          eq(calendarSubscriptions.tenantId, tenantId),
          eq(calendarSubscriptions.tokenHash, tokenHash),
          isNull(calendarSubscriptions.revokedAt),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  async activeSubscription(
    transaction: DatabaseTransaction,
    input: { tenantId: string; subscriptionId: string; userId: string; employeeId: string },
  ) {
    const [subscription] = await transaction
      .select({ id: calendarSubscriptions.id })
      .from(calendarSubscriptions)
      .where(
        and(
          eq(calendarSubscriptions.tenantId, input.tenantId),
          eq(calendarSubscriptions.id, input.subscriptionId),
          eq(calendarSubscriptions.userId, input.userId),
          eq(calendarSubscriptions.employeeId, input.employeeId),
          isNull(calendarSubscriptions.revokedAt),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  async revokeActiveForEmployee(
    transaction: DatabaseTransaction,
    input: { tenantId: string; employeeId: string; revokedAt: Date },
  ) {
    return transaction
      .update(calendarSubscriptions)
      .set({ revokedAt: input.revokedAt })
      .where(
        and(
          eq(calendarSubscriptions.tenantId, input.tenantId),
          eq(calendarSubscriptions.employeeId, input.employeeId),
          isNull(calendarSubscriptions.revokedAt),
        ),
      )
      .returning({ id: calendarSubscriptions.id });
  }

  async insert(
    transaction: DatabaseTransaction,
    input: typeof calendarSubscriptions.$inferInsert,
  ): Promise<void> {
    await transaction.insert(calendarSubscriptions).values(input);
  }

  async calendarEventsForEmployee(
    transaction: DatabaseTransaction,
    input: { tenantId: string; employeeId: string; from: Date; until: Date },
  ): Promise<CalendarFeedRow[]> {
    const assignmentHistory = transaction
      .select({ id: visitAssignments.id })
      .from(visitAssignments)
      .where(
        and(
          eq(visitAssignments.tenantId, input.tenantId),
          eq(visitAssignments.visitId, visits.id),
          eq(visitAssignments.employeeId, input.employeeId),
        ),
      );
    return transaction
      .select({
        visitId: visits.id,
        clientId: visits.clientId,
        tenantId: visits.tenantId,
        organizationId: visits.organizationId,
        facilityId: visits.facilityId,
        status: visits.status,
        plannedStart: visits.plannedStart,
        plannedEnd: visits.plannedEnd,
        createdAt: visits.createdAt,
        updatedAt: visits.updatedAt,
        currentlyAssigned: sql<boolean>`${exists(
          transaction
            .select({ id: visitAssignments.id })
            .from(visitAssignments)
            .where(
              and(
                eq(visitAssignments.tenantId, input.tenantId),
                eq(visitAssignments.visitId, visits.id),
                eq(visitAssignments.employeeId, input.employeeId),
                eq(visitAssignments.status, 'active'),
              ),
            ),
        )}`,
      })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, input.tenantId),
          gte(visits.plannedStart, input.from),
          lt(visits.plannedStart, input.until),
          exists(assignmentHistory),
        ),
      )
      .orderBy(asc(visits.plannedStart), asc(visits.id));
  }

  async teamIdsForVisits(
    transaction: DatabaseTransaction,
    tenantId: string,
    visitIds: string[],
  ): Promise<Array<{ visitId: string; teamId: string }>> {
    if (visitIds.length === 0) return [];
    return transaction
      .selectDistinct({
        visitId: visitAssignments.visitId,
        teamId: employeeTeamMemberships.teamId,
      })
      .from(visitAssignments)
      .innerJoin(
        employeeTeamMemberships,
        and(
          eq(employeeTeamMemberships.tenantId, visitAssignments.tenantId),
          eq(employeeTeamMemberships.employeeId, visitAssignments.employeeId),
          eq(employeeTeamMemberships.status, 'active'),
        ),
      )
      .where(
        and(
          eq(visitAssignments.tenantId, tenantId),
          inArray(visitAssignments.visitId, visitIds),
          eq(visitAssignments.status, 'active'),
        ),
      );
  }
}
