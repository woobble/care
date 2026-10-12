import { v7 as uuidv7 } from 'uuid';
import { and, asc, eq, gte, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { AuditWriter } from '@care/audit';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { OutboxWriter } from '@care/platform';
import { clientRecords } from '@care/clients';
import { benefitFundingSources, clientBenefitEntitlements } from '@care/benefits';
import {
  employeeFacilityAssignments,
  employeeQualifications,
  employeeRecords,
} from '@care/employees';
import { payerArrangements } from '@care/billing';
import { agreements } from '@care/service-agreements';
import { localDateTimeToInstant } from '@care/scheduling';
import { organizationsTable } from '@care/organizations';
import { readOperationsReceivableDeadlines } from '@care/billing';
import { stableIssueId } from '../domain/operations';
import { OperationsAssigneeInvalidError, validateOperationsAssignee } from './operations-guards';
import {
  exceptionOccurrences,
  reminderPolicies,
  schedulerRuns,
  taskActivity,
  tasks,
} from '../schema';

const MAX_AGREEMENTS_PER_RUN = 500;
const RUN_LEASE_MS = 5 * 60 * 1000;
const MAX_PROJECTED_DEADLINES_PER_SOURCE = 500;

type DeadlineProjection = {
  issueKey: string;
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: string;
  issueCode: string;
  category: 'benefits' | 'billing' | 'onboarding' | 'agreements' | 'employees';
  severity: 'warning' | 'critical';
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  sourceAt: Date;
  dueAt: Date;
};

export interface OperationsDeadlineSourceServices {
  benefits: {
    operationsCarryoverDeadlines(
      transaction: DatabaseTransaction,
      tenantId: string,
      asOfDate: string,
      expiryLookaheadDays: number,
      maxClients?: number,
      afterClientId?: string | null,
    ): Promise<{
      items: Array<{
        clientId: string;
        organizationId: string | null;
        facilityId: string | null;
        dueDate: string;
      }>;
      complete: boolean;
      nextCursor: string | null;
    }>;
  };
  onboardingCases: (
    transaction: DatabaseTransaction,
    tenantId: string,
    fromDate: string,
    untilDate: string,
    maxCases?: number,
    afterCaseId?: string | null,
  ) => Promise<{
    items: Array<{
      id: string;
      organizationId: string;
      facilityId: string | null;
      clientId: string | null;
      nextFollowUpAt: Date | null;
      preferredStartDate: string | null;
    }>;
    complete: boolean;
    nextCursor: string | null;
  }>;
}

export class OperationsDeadlineTaskScheduler {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly sources: OperationsDeadlineSourceServices,
  ) {}

  async run(tenantId: string, workerId: string, now = new Date()) {
    try {
      const tasksCreated = await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
        const lock = await transaction.execute(
          sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`operations-deadlines:${tenantId}`}, 0)) AS locked`,
        );
        const locked = Boolean(
          (lock as unknown as { rows?: Array<{ locked?: boolean }> }).rows?.[0]?.locked,
        );
        if (!locked) return null;
        await transaction
          .insert(schedulerRuns)
          .values({
            id: uuidv7(),
            tenantId,
            jobName: 'deadline_evaluation',
            status: 'running',
            workerId,
            leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
            lastStartedAt: now,
            lastSucceededAt: null,
            lastFailedAt: null,
            lastFailureCode: null,
            tasksCreated: 0,
            remindersTriggered: 0,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [schedulerRuns.tenantId, schedulerRuns.jobName],
            set: {
              status: 'running',
              workerId,
              leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
              lastStartedAt: now,
              tasksCreated: 0,
              remindersTriggered: 0,
              updatedAt: now,
            },
          });

        const policies = await transaction
          .select()
          .from(reminderPolicies)
          .where(
            and(
              eq(reminderPolicies.tenantId, tenantId),
              eq(reminderPolicies.category, 'agreements'),
              eq(reminderPolicies.enabled, true),
              eq(reminderPolicies.createFollowUpTask, true),
            ),
          )
          .orderBy(asc(reminderPolicies.organizationId));
        let created = 0;
        // The query is bounded per policy, and one tenant advisory lock serializes retries.
        // oxlint-disable no-await-in-loop
        for (const policy of policies) {
          const [organization] = await transaction
            .select({ timezone: organizationsTable.timezone })
            .from(organizationsTable)
            .where(
              and(
                eq(organizationsTable.tenantId, tenantId),
                eq(organizationsTable.id, policy.organizationId),
              ),
            )
            .limit(1);
          if (!organization) continue;
          const timezone = organization.timezone || 'Europe/Berlin';
          const today = localDateKey(now, timezone);
          const maximumLead = Math.min(365, Math.max(0, ...policy.offsetsDays));
          const agreementsToReview = await transaction
            .select({
              id: agreements.id,
              clientId: agreements.clientId,
              facilityId: agreements.facilityId,
              validUntil: agreements.validUntil,
            })
            .from(agreements)
            .where(
              and(
                eq(agreements.tenantId, tenantId),
                eq(agreements.organizationId, policy.organizationId),
                inArray(agreements.status, ['active', 'suspended']),
                isNotNull(agreements.validUntil),
                gte(agreements.validUntil, addDays(today, -365)),
                lte(agreements.validUntil, addDays(today, maximumLead)),
              ),
            )
            .orderBy(asc(agreements.validUntil), asc(agreements.id))
            .limit(MAX_AGREEMENTS_PER_RUN);
          for (const agreement of agreementsToReview) {
            if (!agreement.validUntil) continue;
            const remainingDays = dayDifference(agreement.validUntil, today);
            if (remainingDays >= 0 && remainingDays > Math.max(0, ...policy.offsetsDays)) continue;
            const sourceDeadlineKey = stableIssueId(
              'service_agreements',
              'agreement',
              agreement.id,
              'agreement_expiry',
            );
            const [existing] = await transaction
              .select({ id: tasks.id })
              .from(tasks)
              .where(
                and(eq(tasks.tenantId, tenantId), eq(tasks.sourceDeadlineKey, sourceDeadlineKey)),
              )
              .limit(1);
            if (existing) continue;
            let assignedEmployeeId = policy.assignedEmployeeId;
            let assignmentWarningCode: 'assignee_unavailable' | null = null;
            if (assignedEmployeeId) {
              try {
                await validateOperationsAssignee(
                  transaction,
                  tenantId,
                  assignedEmployeeId,
                  policy.organizationId,
                  agreement.facilityId,
                );
              } catch (error) {
                if (!(error instanceof OperationsAssigneeInvalidError)) throw error;
                assignedEmployeeId = null;
                assignmentWarningCode = 'assignee_unavailable';
              }
            }
            const dueAt = localDateTimeToInstant(agreement.validUntil, '23:59', timezone, 'later');
            if (!dueAt) continue;
            dueAt.setTime(dueAt.getTime() + 59_999);
            const taskId = uuidv7();
            await transaction.insert(tasks).values({
              id: taskId,
              tenantId,
              organizationId: policy.organizationId,
              facilityId: agreement.facilityId,
              clientId: agreement.clientId,
              title: 'Review service agreement validity',
              description: null,
              status: 'open',
              priority: remainingDays < 0 ? 'urgent' : 'high',
              assignedEmployeeId,
              createdByUserId: policy.updatedByUserId,
              completedByUserId: null,
              dueAt,
              completedAt: null,
              assignmentWarningCode,
              sourceType: 'service_agreement',
              sourceClientId: null,
              sourceVisitId: null,
              sourceAgreementId: agreement.id,
              sourceEvidencePackageId: null,
              sourceInvoiceId: null,
              sourceClaimId: null,
              sourceEntitlementId: null,
              sourceDocumentId: null,
              sourceCommunicationId: null,
              sourceDeadlineKey,
              version: 1,
              createdAt: now,
              updatedAt: now,
            });
            await transaction.insert(taskActivity).values({
              id: uuidv7(),
              tenantId,
              taskId,
              actorUserId: policy.updatedByUserId,
              kind: 'created',
              details: {
                source: 'domain_deadline',
                sourceDomain: 'service_agreements',
                deadlineCode: 'agreement_expiry',
                sourceDeadlineKey,
                ...(assignmentWarningCode ? { assignmentWarningCode } : {}),
              },
              comment: null,
              occurredAt: now,
            });
            const event = createDomainEvent({
              type: 'operations.task_created',
              tenantId,
              aggregateType: 'operations',
              aggregateId: taskId,
              actor: { type: 'system' },
              correlationId: uuidv7(),
              payload: {
                taskId,
                organizationId: policy.organizationId,
                clientId: agreement.clientId,
              },
            });
            await this.audit.append(transaction, {
              id: event.id,
              tenantId,
              actorId: policy.updatedByUserId,
              action: event.type,
              resourceType: 'office_task',
              resourceId: taskId,
              timestamp: now,
              requestId: 'operations-deadline-scheduler',
              correlationId: event.correlationId,
              metadata: {
                sourceDomain: 'service_agreements',
                deadlineCode: 'agreement_expiry',
                taskId,
              },
            });
            await this.outbox.enqueue(transaction, event);
            created += 1;
          }
        }
        // oxlint-enable no-await-in-loop
        return created;
      });
      if (tasksCreated === null) return { status: 'busy' as const, tasksCreated: 0 };

      const evaluation = await this.evaluateDeadlineOccurrences(tenantId, now);
      await this.unitOfWork.transaction({ tenantId }, (transaction) =>
        transaction
          .update(schedulerRuns)
          .set({
            status: evaluation.failedDomains.length ? 'failed' : 'succeeded',
            leaseUntil: null,
            lastSucceededAt: evaluation.failedDomains.length ? undefined : now,
            lastFailedAt: evaluation.failedDomains.length ? now : undefined,
            lastFailureCode: evaluation.failedDomains.length
              ? 'DeadlineDomainEvaluationFailed'
              : undefined,
            tasksCreated,
            remindersTriggered: evaluation.remindersTriggered,
            updatedAt: now,
          })
          .where(
            and(
              eq(schedulerRuns.tenantId, tenantId),
              eq(schedulerRuns.jobName, 'deadline_evaluation'),
              eq(schedulerRuns.workerId, workerId),
              eq(schedulerRuns.lastStartedAt, now),
            ),
          ),
      );
      return {
        status: evaluation.failedDomains.length ? ('partial' as const) : ('succeeded' as const),
        tasksCreated,
        remindersTriggered: evaluation.remindersTriggered,
        failedDomains: evaluation.failedDomains,
      };
    } catch (error) {
      await this.unitOfWork.transaction({ tenantId }, (transaction) =>
        transaction
          .insert(schedulerRuns)
          .values({
            id: uuidv7(),
            tenantId,
            jobName: 'deadline_evaluation',
            status: 'failed',
            workerId,
            leaseUntil: null,
            lastStartedAt: now,
            lastSucceededAt: null,
            lastFailedAt: now,
            lastFailureCode: safeFailureCode(error),
            tasksCreated: 0,
            remindersTriggered: 0,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [schedulerRuns.tenantId, schedulerRuns.jobName],
            set: {
              status: 'failed',
              workerId,
              leaseUntil: null,
              lastStartedAt: now,
              lastFailedAt: now,
              lastFailureCode: safeFailureCode(error),
              updatedAt: now,
            },
          }),
      );
      throw error;
    }
  }

  private async evaluateDeadlineOccurrences(tenantId: string, now: Date) {
    const failedDomains: string[] = [];
    let remindersTriggered = 0;
    const run = async (
      name: string,
      issueCodes: string[],
      read: (
        transaction: DatabaseTransaction,
        afterId: string | null,
      ) => Promise<{
        items: DeadlineProjection[];
        complete: boolean;
        nextCursor: string | null;
      }>,
    ) => {
      try {
        remindersTriggered += await this.unitOfWork.transaction(
          { tenantId },
          async (transaction) => {
            await transaction.execute(
              sql`SELECT pg_advisory_xact_lock(hashtextextended(${`operations-deadline-source:${tenantId}:${name}`}, 0))`,
            );
            const [schedulerRun] = await transaction
              .select({ projectionCursors: schedulerRuns.projectionCursors })
              .from(schedulerRuns)
              .where(
                and(
                  eq(schedulerRuns.tenantId, tenantId),
                  eq(schedulerRuns.jobName, 'deadline_evaluation'),
                ),
              )
              .for('update')
              .limit(1);
            const cursors = schedulerRun?.projectionCursors ?? {};
            const afterId = cursors[name] ?? null;
            const result = await read(transaction, afterId);
            const eligible = await this.applyReminderPolicy(
              transaction,
              tenantId,
              result.items,
              now,
            );
            const inserted = await this.syncDeadlineOccurrences(
              transaction,
              tenantId,
              name,
              issueCodes,
              eligible,
              afterId,
              result.nextCursor,
              result.complete,
              now,
            );
            await transaction
              .update(schedulerRuns)
              .set({
                projectionCursors: {
                  ...cursors,
                  [name]: result.complete ? null : result.nextCursor,
                },
              })
              .where(
                and(
                  eq(schedulerRuns.tenantId, tenantId),
                  eq(schedulerRuns.jobName, 'deadline_evaluation'),
                ),
              );
            return inserted;
          },
        );
      } catch {
        failedDomains.push(name);
      }
    };

    const range = await this.unitOfWork.transaction({ tenantId }, async (transaction) => {
      const policies = await transaction
        .select({ category: reminderPolicies.category, offsetsDays: reminderPolicies.offsetsDays })
        .from(reminderPolicies)
        .where(eq(reminderPolicies.tenantId, tenantId));
      const maximumLeadDays = Math.min(
        365,
        Math.max(30, ...policies.flatMap((policy) => policy.offsetsDays)),
      );
      const timezoneRows = await transaction
        .select({ id: organizationsTable.id, timezone: organizationsTable.timezone })
        .from(organizationsTable)
        .where(eq(organizationsTable.tenantId, tenantId));
      const timezones = new Map(
        timezoneRows.map((row) => [row.id, row.timezone ?? 'Europe/Berlin']),
      );
      const todayByOrganization = new Map(
        timezoneRows.map((row) => [row.id, localDateKey(now, row.timezone ?? 'Europe/Berlin')]),
      );
      const today = localDateKey(now, 'UTC');
      return {
        maximumLeadDays,
        deadlineFrom: addDays(today, -365),
        deadlineUntil: addDays(today, 365),
        fromDate: addDays(today, -365),
        untilDate: addDays(today, maximumLeadDays),
        timezones,
        todayByOrganization,
      };
    });

    await run(
      'service_agreements:agreement_expiry',
      ['agreement_expiry'],
      async (transaction, afterId) => {
        const rows = await transaction
          .select({
            id: agreements.id,
            organizationId: agreements.organizationId,
            facilityId: agreements.facilityId,
            clientId: agreements.clientId,
            validUntil: agreements.validUntil,
          })
          .from(agreements)
          .where(
            and(
              eq(agreements.tenantId, tenantId),
              inArray(agreements.status, ['active', 'suspended']),
              isNotNull(agreements.validUntil),
              gte(agreements.validUntil, range.deadlineFrom),
              lte(agreements.validUntil, range.deadlineUntil),
              ...(afterId ? [gt(agreements.id, afterId)] : []),
            ),
          )
          .orderBy(asc(agreements.id))
          .limit(MAX_PROJECTED_DEADLINES_PER_SOURCE + 1);
        const complete = rows.length <= MAX_PROJECTED_DEADLINES_PER_SOURCE;
        const pageRows = rows.slice(0, MAX_PROJECTED_DEADLINES_PER_SOURCE);
        return {
          complete,
          nextCursor: pageRows.at(-1)?.id ?? null,
          items: pageRows.flatMap((row) => {
            if (!row.validUntil) return [];
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.validUntil, timezone);
            if (!dueAt) return [];
            return [
              deadlineProjection({
                sourceDomain: 'service_agreements',
                sourceEntityType: 'agreement',
                sourceEntityId: row.id,
                issueCode: 'agreement_expiry',
                category: 'agreements',
                severity: dueAt < now ? 'critical' : 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
                sourceAt: new Date(`${row.validUntil}T12:00:00.000Z`),
                dueAt,
              }),
            ];
          }),
        };
      },
    );

    await run(
      'employee_qualifications:qualification_expiry',
      ['qualification_expiry'],
      async (transaction, afterId) => {
        const rows = await transaction
          .select({
            id: employeeQualifications.id,
            employeeId: employeeRecords.id,
            organizationId: employeeRecords.organizationId,
            facilityId: employeeFacilityAssignments.facilityId,
            validUntil: employeeQualifications.validUntil,
          })
          .from(employeeQualifications)
          .innerJoin(
            employeeRecords,
            and(
              eq(employeeRecords.tenantId, employeeQualifications.tenantId),
              eq(employeeRecords.id, employeeQualifications.employeeId),
            ),
          )
          .leftJoin(
            employeeFacilityAssignments,
            and(
              eq(employeeFacilityAssignments.tenantId, employeeRecords.tenantId),
              eq(employeeFacilityAssignments.employeeId, employeeRecords.id),
              eq(employeeFacilityAssignments.organizationId, employeeRecords.organizationId),
              eq(employeeFacilityAssignments.isPrimary, true),
              eq(employeeFacilityAssignments.status, 'active'),
            ),
          )
          .where(
            and(
              eq(employeeQualifications.tenantId, tenantId),
              eq(employeeQualifications.status, 'active'),
              eq(employeeRecords.status, 'active'),
              isNotNull(employeeQualifications.validUntil),
              gte(employeeQualifications.validUntil, range.deadlineFrom),
              lte(employeeQualifications.validUntil, range.deadlineUntil),
              ...(afterId ? [gt(employeeQualifications.id, afterId)] : []),
            ),
          )
          .orderBy(asc(employeeQualifications.id))
          .limit(MAX_PROJECTED_DEADLINES_PER_SOURCE + 1);
        const complete = rows.length <= MAX_PROJECTED_DEADLINES_PER_SOURCE;
        const pageRows = rows.slice(0, MAX_PROJECTED_DEADLINES_PER_SOURCE);
        return {
          complete,
          nextCursor: pageRows.at(-1)?.id ?? null,
          items: pageRows.flatMap((row) => {
            if (!row.validUntil || !row.organizationId) return [];
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.validUntil, timezone);
            if (!dueAt) return [];
            return [
              deadlineProjection({
                sourceDomain: 'employee_qualifications',
                sourceEntityType: 'employee_qualification',
                sourceEntityId: row.id,
                issueCode: 'qualification_expiry',
                category: 'employees',
                severity: dueAt < now ? 'critical' : 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: null,
                sourceAt: new Date(`${row.validUntil}T12:00:00.000Z`),
                dueAt,
              }),
            ];
          }),
        };
      },
    );

    await run(
      'benefits:benefit_entitlement_expiry',
      ['benefit_entitlement_expiry'],
      async (transaction, afterId) => {
        const rows = await transaction
          .select({
            id: clientBenefitEntitlements.id,
            clientId: clientRecords.id,
            organizationId: clientRecords.organizationId,
            facilityId: clientRecords.primaryFacilityId,
            validUntil: clientBenefitEntitlements.validUntil,
          })
          .from(clientBenefitEntitlements)
          .innerJoin(
            benefitFundingSources,
            and(
              eq(benefitFundingSources.tenantId, clientBenefitEntitlements.tenantId),
              eq(benefitFundingSources.clientId, clientBenefitEntitlements.clientId),
              eq(benefitFundingSources.id, clientBenefitEntitlements.fundingSourceId),
              eq(benefitFundingSources.status, 'active'),
            ),
          )
          .innerJoin(
            clientRecords,
            and(
              eq(clientRecords.tenantId, clientBenefitEntitlements.tenantId),
              eq(clientRecords.id, clientBenefitEntitlements.clientId),
            ),
          )
          .where(
            and(
              eq(clientBenefitEntitlements.tenantId, tenantId),
              inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional']),
              isNotNull(clientBenefitEntitlements.validUntil),
              gte(clientBenefitEntitlements.validUntil, range.deadlineFrom),
              lte(clientBenefitEntitlements.validUntil, range.deadlineUntil),
              ...(afterId ? [gt(clientBenefitEntitlements.id, afterId)] : []),
            ),
          )
          .orderBy(asc(clientBenefitEntitlements.id))
          .limit(MAX_PROJECTED_DEADLINES_PER_SOURCE + 1);
        const complete = rows.length <= MAX_PROJECTED_DEADLINES_PER_SOURCE;
        const pageRows = rows.slice(0, MAX_PROJECTED_DEADLINES_PER_SOURCE);
        return {
          complete,
          nextCursor: pageRows.at(-1)?.id ?? null,
          items: pageRows.flatMap((row) => {
            if (!row.validUntil || !row.organizationId) return [];
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.validUntil, timezone);
            if (!dueAt) return [];
            return [
              deadlineProjection({
                sourceDomain: 'benefits',
                sourceEntityType: 'benefit_entitlement',
                sourceEntityId: row.id,
                issueCode: 'benefit_entitlement_expiry',
                category: 'benefits',
                severity: dueAt < now ? 'critical' : 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
                sourceAt: new Date(`${row.validUntil}T12:00:00.000Z`),
                dueAt,
              }),
            ];
          }),
        };
      },
    );

    await run(
      'billing:payer_authorization_expiry',
      ['payer_authorization_expiry'],
      async (transaction, afterId) => {
        const rows = await transaction
          .select({
            id: payerArrangements.id,
            clientId: clientRecords.id,
            organizationId: payerArrangements.organizationId,
            facilityId: clientRecords.primaryFacilityId,
            validUntil: payerArrangements.validUntil,
          })
          .from(payerArrangements)
          .innerJoin(
            clientRecords,
            and(
              eq(clientRecords.tenantId, payerArrangements.tenantId),
              eq(clientRecords.id, payerArrangements.clientId),
            ),
          )
          .where(
            and(
              eq(payerArrangements.tenantId, tenantId),
              eq(payerArrangements.mandateStatus, 'authorized'),
              lte(payerArrangements.validFrom, localDateKey(now, 'UTC')),
              isNotNull(payerArrangements.validUntil),
              gte(payerArrangements.validUntil, range.deadlineFrom),
              lte(payerArrangements.validUntil, range.deadlineUntil),
              ...(afterId ? [gt(payerArrangements.id, afterId)] : []),
            ),
          )
          .orderBy(asc(payerArrangements.id))
          .limit(MAX_PROJECTED_DEADLINES_PER_SOURCE + 1);
        const complete = rows.length <= MAX_PROJECTED_DEADLINES_PER_SOURCE;
        const pageRows = rows.slice(0, MAX_PROJECTED_DEADLINES_PER_SOURCE);
        return {
          complete,
          nextCursor: pageRows.at(-1)?.id ?? null,
          items: pageRows.flatMap((row) => {
            if (!row.validUntil) return [];
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.validUntil, timezone);
            if (!dueAt) return [];
            return [
              deadlineProjection({
                sourceDomain: 'billing',
                sourceEntityType: 'payer_arrangement',
                sourceEntityId: row.id,
                issueCode: 'payer_authorization_expiry',
                category: 'billing',
                severity: dueAt < now ? 'critical' : 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
                sourceAt: new Date(`${row.validUntil}T12:00:00.000Z`),
                dueAt,
              }),
            ];
          }),
        };
      },
    );

    await run('billing:receivable_due', ['receivable_due'], async (transaction, afterId) => {
      const result = await readOperationsReceivableDeadlines(
        transaction,
        tenantId,
        MAX_PROJECTED_DEADLINES_PER_SOURCE,
        afterId,
      );
      return {
        complete: result.complete,
        nextCursor: result.nextCursor,
        items: result.items.flatMap((row) => {
          const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
          const dueAt = dateDeadline(row.dueDate, timezone);
          if (!dueAt) return [];
          return [
            deadlineProjection({
              sourceDomain: 'billing',
              sourceEntityType: 'invoice',
              sourceEntityId: row.id,
              issueCode: 'receivable_due',
              category: 'billing',
              severity:
                row.dueDate < (range.todayByOrganization.get(row.organizationId) ?? '')
                  ? 'critical'
                  : 'warning',
              organizationId: row.organizationId,
              facilityId: row.facilityId,
              clientId: row.clientId,
              sourceAt: new Date(`${row.dueDate}T12:00:00.000Z`),
              dueAt,
            }),
          ];
        }),
      };
    });

    await run(
      'benefits:carryover_expiring',
      ['carryover_expiring'],
      async (transaction, afterId) => {
        const benefitRows = await this.sources.benefits.operationsCarryoverDeadlines(
          transaction,
          tenantId,
          localDateKey(now, 'UTC'),
          range.maximumLeadDays,
          MAX_PROJECTED_DEADLINES_PER_SOURCE,
          afterId,
        );
        return {
          complete: benefitRows.complete,
          nextCursor: benefitRows.nextCursor,
          items: benefitRows.items.flatMap((row) => {
            if (!row.organizationId) return [];
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.dueDate, timezone);
            if (!dueAt) return [];
            return [
              deadlineProjection({
                sourceDomain: 'benefits',
                sourceEntityType: 'client',
                sourceEntityId: row.clientId,
                issueCode: 'carryover_expiring',
                category: 'benefits',
                severity: 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
                sourceAt: new Date(`${row.dueDate}T12:00:00.000Z`),
                dueAt,
              }),
            ];
          }),
        };
      },
    );

    await run(
      'onboarding:follow_up_and_start_date',
      ['admission_follow_up_due', 'admission_follow_up_overdue', 'admission_start_date'],
      async (transaction, afterId) => {
        const result = await this.sources.onboardingCases(
          transaction,
          tenantId,
          range.fromDate,
          range.untilDate,
          MAX_PROJECTED_DEADLINES_PER_SOURCE,
          afterId,
        );
        const items = result.items.flatMap((row) => {
          const deadlines: DeadlineProjection[] = [];
          if (row.nextFollowUpAt) {
            const overdue = row.nextFollowUpAt < now;
            deadlines.push(
              deadlineProjection({
                sourceDomain: 'onboarding',
                sourceEntityType: 'admission_case',
                sourceEntityId: row.id,
                issueCode: overdue ? 'admission_follow_up_overdue' : 'admission_follow_up_due',
                category: 'onboarding',
                severity: overdue ? 'critical' : 'warning',
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
                sourceAt: row.nextFollowUpAt,
                dueAt: row.nextFollowUpAt,
              }),
            );
          }
          if (row.preferredStartDate) {
            const timezone = range.timezones.get(row.organizationId) ?? 'Europe/Berlin';
            const dueAt = dateDeadline(row.preferredStartDate, timezone);
            if (dueAt) {
              deadlines.push(
                deadlineProjection({
                  sourceDomain: 'onboarding',
                  sourceEntityType: 'admission_case',
                  sourceEntityId: row.id,
                  issueCode: 'admission_start_date',
                  category: 'onboarding',
                  severity: dueAt < now ? 'critical' : 'warning',
                  organizationId: row.organizationId,
                  facilityId: row.facilityId,
                  clientId: row.clientId,
                  sourceAt: new Date(`${row.preferredStartDate}T12:00:00.000Z`),
                  dueAt,
                }),
              );
            }
          }
          return deadlines;
        });
        return { items, complete: result.complete, nextCursor: result.nextCursor };
      },
    );

    return { remindersTriggered, failedDomains };
  }

  private async applyReminderPolicy(
    transaction: DatabaseTransaction,
    tenantId: string,
    items: DeadlineProjection[],
    now: Date,
  ) {
    if (!items.length) return items;
    const policies = await transaction
      .select({
        organizationId: reminderPolicies.organizationId,
        category: reminderPolicies.category,
        offsetsDays: reminderPolicies.offsetsDays,
        enabled: reminderPolicies.enabled,
      })
      .from(reminderPolicies)
      .where(eq(reminderPolicies.tenantId, tenantId));
    const organizations = await transaction
      .select({ id: organizationsTable.id, timezone: organizationsTable.timezone })
      .from(organizationsTable)
      .where(eq(organizationsTable.tenantId, tenantId));
    const policyByOrgCategory = new Map(
      policies.map((policy) => [`${policy.organizationId}:${policy.category}`, policy]),
    );
    const timezoneByOrg = new Map(
      organizations.map((row) => [row.id, row.timezone ?? 'Europe/Berlin']),
    );
    return items.filter((item) => {
      const timezone = timezoneByOrg.get(item.organizationId) ?? 'Europe/Berlin';
      const remainingDays = dayDifference(
        localDateKey(item.dueAt, timezone),
        localDateKey(now, timezone),
      );
      if (remainingDays < 0 || item.severity === 'critical') return true;
      const policy = policyByOrgCategory.get(`${item.organizationId}:${item.category}`);
      if (policy?.enabled === false) return false;
      return remainingDays <= Math.max(0, ...(policy?.offsetsDays ?? [30, 7, 0]));
    });
  }

  private async syncDeadlineOccurrences(
    transaction: DatabaseTransaction,
    tenantId: string,
    sourceName: string,
    issueCodes: string[],
    items: DeadlineProjection[],
    afterId: string | null,
    throughId: string | null,
    endOfSource: boolean,
    observedAt: Date,
  ): Promise<number> {
    const issueKeys = [...new Set(items.map((item) => item.issueKey))];
    const activeCurrent = issueKeys.length
      ? await transaction
          .select({
            id: exceptionOccurrences.id,
            issueKey: exceptionOccurrences.issueKey,
            sourceAt: exceptionOccurrences.sourceAt,
          })
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, tenantId),
              inArray(exceptionOccurrences.issueKey, issueKeys),
              isNull(exceptionOccurrences.resolvedAt),
            ),
          )
      : [];
    const itemByKey = new Map(items.map((item) => [item.issueKey, item]));
    const superseded = activeCurrent.filter((row) => {
      const item = itemByKey.get(row.issueKey);
      return item !== undefined && row.sourceAt?.getTime() !== item.sourceAt.getTime();
    });
    if (superseded.length) {
      await transaction
        .update(exceptionOccurrences)
        .set({ resolvedAt: observedAt, version: sql`${exceptionOccurrences.version} + 1` })
        .where(
          and(
            eq(exceptionOccurrences.tenantId, tenantId),
            inArray(
              exceptionOccurrences.id,
              superseded.map((row) => row.id),
            ),
            isNull(exceptionOccurrences.resolvedAt),
          ),
        );
    }
    const supersededIds = new Set(superseded.map((row) => row.id));
    const activeKeys = new Set(
      activeCurrent.filter((row) => !supersededIds.has(row.id)).map((row) => row.issueKey),
    );
    const missing = items.filter((item) => !activeKeys.has(item.issueKey));
    let insertedCount = 0;
    if (missing.length) {
      const inserted = await transaction
        .insert(exceptionOccurrences)
        .values(
          missing.map((item) => ({
            id: uuidv7(),
            tenantId,
            issueKey: item.issueKey,
            sourceDomain: item.sourceDomain,
            sourceEntityType: item.sourceEntityType,
            sourceEntityId: item.sourceEntityId,
            issueCode: item.issueCode,
            category: item.category,
            severity: item.severity,
            organizationId: item.organizationId,
            facilityId: item.facilityId,
            clientId: item.clientId,
            sourceAt: item.sourceAt,
            firstDetectedAt: observedAt,
            lastObservedAt: observedAt,
            resolvedAt: null,
            version: 1,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: exceptionOccurrences.id });
      insertedCount = inserted.length;
    }
    if (items.length) {
      const observedValues = sql.join(
        items.map(
          (item) =>
            sql`(${item.issueKey}, ${item.sourceAt}::timestamptz, ${item.severity}, ${item.category}, ${item.organizationId}::uuid, ${item.facilityId}::uuid, ${item.clientId}::uuid)`,
        ),
        sql`, `,
      );
      await transaction.execute(sql`
        UPDATE operations.exception_occurrences AS occurrence
        SET last_observed_at = ${observedAt},
            source_at = observed.source_at,
            severity = observed.severity,
            category = observed.category,
            organization_id = observed.organization_id,
            facility_id = observed.facility_id,
            client_id = observed.client_id,
            version = occurrence.version + 1
        FROM (VALUES ${observedValues}) AS observed(
          issue_key, source_at, severity, category, organization_id, facility_id, client_id
        )
        WHERE occurrence.tenant_id = ${tenantId}
          AND occurrence.issue_key = observed.issue_key
          AND occurrence.resolved_at IS NULL
          AND occurrence.last_observed_at < ${observedAt}
      `);
    }

    if (endOfSource || throughId) {
      const currentKeySet = new Set(issueKeys);
      const stale = await transaction
        .select({ id: exceptionOccurrences.id, issueKey: exceptionOccurrences.issueKey })
        .from(exceptionOccurrences)
        .where(
          and(
            eq(exceptionOccurrences.tenantId, tenantId),
            eq(exceptionOccurrences.sourceDomain, sourceName.split(':')[0]!),
            inArray(exceptionOccurrences.issueCode, issueCodes),
            isNull(exceptionOccurrences.resolvedAt),
            lte(exceptionOccurrences.lastObservedAt, observedAt),
            ...(afterId ? [gt(exceptionOccurrences.sourceEntityId, afterId)] : []),
            ...(!endOfSource && throughId
              ? [lte(exceptionOccurrences.sourceEntityId, throughId)]
              : []),
          ),
        );
      const staleIds = stale.filter((row) => !currentKeySet.has(row.issueKey)).map((row) => row.id);
      if (staleIds.length) {
        await transaction
          .update(exceptionOccurrences)
          .set({ resolvedAt: observedAt, version: sql`${exceptionOccurrences.version} + 1` })
          .where(
            and(
              eq(exceptionOccurrences.tenantId, tenantId),
              inArray(exceptionOccurrences.id, staleIds),
              isNull(exceptionOccurrences.resolvedAt),
            ),
          );
      }
    }
    return insertedCount;
  }
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDifference(later: string, earlier: string): number {
  return Math.floor(
    (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86_400_000,
  );
}

function dateDeadline(date: string, timezone: string): Date | null {
  const dueAt = localDateTimeToInstant(date, '23:59', timezone, 'later');
  if (!dueAt) return null;
  dueAt.setTime(dueAt.getTime() + 59_999);
  return dueAt;
}

function deadlineProjection(input: Omit<DeadlineProjection, 'issueKey'>): DeadlineProjection {
  return {
    ...input,
    issueKey: stableIssueId(
      input.sourceDomain,
      input.sourceEntityType,
      input.sourceEntityId,
      input.issueCode,
    ),
  };
}

function safeFailureCode(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
    ? error.name
    : 'UnknownError';
}
