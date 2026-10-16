import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@care/database';

import { admissionAssessments, admissionCases } from '../schema';

const ACTIVE_STAGES = ['inquiry', 'assessment', 'preparation', 'ready_for_admission'] as const;

export async function readOperationsDeadlineCases(
  transaction: DatabaseTransaction,
  tenantId: string,
  fromDate: string,
  untilDate: string,
  maxCases = 500,
  afterCaseId?: string | null,
) {
  const preferredStartDate = sql<
    string | null
  >`coalesce(${admissionAssessments.data}->>'preferredStartDate', ${admissionCases.preferredStartDate}::text)`;
  const rows = await transaction
    .select({
      id: admissionCases.id,
      organizationId: admissionCases.organizationId,
      facilityId: admissionCases.facilityId,
      clientId: admissionCases.clientId,
      nextFollowUpAt: admissionCases.nextFollowUpAt,
      preferredStartDate,
    })
    .from(admissionCases)
    .leftJoin(
      admissionAssessments,
      and(
        eq(admissionAssessments.tenantId, admissionCases.tenantId),
        eq(admissionAssessments.caseId, admissionCases.id),
      ),
    )
    .where(
      and(
        eq(admissionCases.tenantId, tenantId),
        inArray(admissionCases.stage, [...ACTIVE_STAGES]),
        ...(afterCaseId ? [gt(admissionCases.id, afterCaseId)] : []),
        or(
          lte(admissionCases.nextFollowUpAt, new Date(`${untilDate}T23:59:59.999Z`)),
          and(
            sql`${preferredStartDate} >= ${fromDate}`,
            sql`${preferredStartDate} <= ${untilDate}`,
          ),
        ),
      ),
    )
    .orderBy(asc(admissionCases.id))
    .limit(maxCases + 1);
  const items = rows.slice(0, maxCases);
  return {
    items,
    complete: rows.length <= maxCases,
    nextCursor: items.at(-1)?.id ?? null,
  };
}
