// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading worker configuration
import '@care/config/load-env';
import { hostname } from 'node:os';
import { eq } from 'drizzle-orm';
import { EventDispatcher } from '@care/events';
import { loadWorkerConfig } from '@care/config';
import { createDatabase, createUnitOfWork } from '@care/database';
import { createLogger } from '@care/logging';
import { startTelemetry } from '@care/observability';
import { DrizzleOutboxRepository, platformSchema } from '@care/platform';
import { DrizzleAuditWriter } from '@care/audit';
import { billingSchema } from '@care/billing';
import { benefitsSchema, createBenefitsApplicationService } from '@care/benefits';
import { clientsSchema } from '@care/clients';
import { employeesSchema } from '@care/employees';
import { organizationsSchema, tenants } from '@care/organizations';
import { onboardingSchema, readOperationsDeadlineCases } from '@care/onboarding';
import {
  OperationsDeadlineTaskScheduler,
  OperationsRecurrenceApplicationService,
  operationsSchema,
} from '@care/operations';

const batchSize = 50;
const leaseMs = 120_000;
const maxAttempts = 10;

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger('care-worker');
  const stopTelemetry = await startTelemetry('care-worker', config.OTEL_EXPORTER_OTLP_ENDPOINT);
  const database = createDatabase(config.WORKER_DATABASE_URL, {
    ...platformSchema,
    ...organizationsSchema,
    ...clientsSchema,
    ...employeesSchema,
    ...benefitsSchema,
    ...billingSchema,
    ...onboardingSchema,
    ...operationsSchema,
  });
  const outbox = new DrizzleOutboxRepository(database.db);
  const unitOfWork = createUnitOfWork(database.db);
  const auditWriter = new DrizzleAuditWriter();
  const recurrenceScheduler = new OperationsRecurrenceApplicationService(
    unitOfWork,
    auditWriter,
    outbox,
  );
  const deadlineScheduler = new OperationsDeadlineTaskScheduler(unitOfWork, auditWriter, outbox, {
    benefits: createBenefitsApplicationService(unitOfWork, auditWriter, outbox),
    onboardingCases: readOperationsDeadlineCases,
  });
  const dispatcher = new EventDispatcher();
  for (const eventType of [
    'organization.created',
    'organization.updated',
    'organization.activated',
    'organization.archived',
    'operations.recurrence_created',
    'operations.recurrence_updated',
    'operations.recurrence_paused',
    'operations.recurrence_resumed',
    'operations.recurrence_ended',
    'operations.recurring_task_generated',
    'operations.reminder_settings_updated',
    'operations.task_created',
    'facility.created',
    'facility.updated',
    'facility.activated',
    'facility.archived',
    'team.created',
    'team.updated',
    'team.activated',
    'team.archived',
    'employee.created',
    'employee.updated',
    'employee.status_changed',
    'employee.user_linked',
    'employee.user_unlinked',
    'employee.facility_assignment_changed',
    'employee.team_membership_changed',
    'employee.qualification_changed',
    'employee.skill_changed',
    'qualification.created',
    'qualification.updated',
    'qualification.archived',
    'skill.created',
    'skill.updated',
    'skill.archived',
    'client.created',
    'client.updated',
    'client.activated',
    'client.archived',
    'client.provider_context_changed',
    'client.address_changed',
    'client.contact_changed',
    'client.insurance_changed',
    'client.pflegegrad_changed',
    'communication.recorded',
    'communication.amended',
    'communication.preferences_updated',
    'service.category_created',
    'service.category_updated',
    'service.category_archived',
    'service.created',
    'service.updated',
    'service.archived',
    'service.availability_changed',
    'service.price_recorded',
    'service_agreement.created',
    'service_agreement.updated',
    'service_agreement.activated',
    'service_agreement.suspended',
    'service_agreement.resumed',
    'service_agreement.ended',
    'service_agreement.service_added',
    'service_agreement.service_changed',
    'service_agreement.service_ended',
    'visit.created',
    'visit.generated',
    'visit.updated',
    'visit.rescheduled',
    'visit.confirmed',
    'visit.unconfirmed',
    'visit.cancelled',
    'visit.assignment_changed',
    'visit_execution.started',
    'visit_execution.completed',
    'visit_execution.corrected',
    'care_documentation.created',
    'care_documentation.entry_added',
    'care_documentation.entry_updated',
    'care_documentation.entry_removed',
    'care_documentation.finalized',
    'care_documentation.amended',
    'benefit.entitlement_created',
    'benefit.entitlement_updated',
    'benefit.opening_balance_recorded',
    'benefit.adjustment_recorded',
    'benefit.service_allocated',
    'benefit.allocation_reversed',
    'billing.profile.updated',
    'billing.payer_arrangement.created',
    'billing.payer_arrangement.updated',
    'invoice.created',
    'invoice.updated',
    'invoice.issued',
    'invoice.cancelled',
    'invoice.corrected',
    'payment.recorded',
    'payment.allocated',
    'payment.allocation_reversed',
    'evidence_package.created',
    'evidence_package.superseded',
    'service_evidence.acknowledged',
    'service_evidence.declined',
    'service_evidence.acknowledgement_revoked',
    'service_evidence.recorded',
    'service_evidence.updated',
    'incident.recorded',
    'performed_service.recorded',
    'performed_service.updated',
    'performed_service.marked_not_performed',
    'performed_service.unplanned_added',
    'schedule.generation_completed',
    'employee.unavailability_created',
    'tenant.invitation.created',
    'tenant.invitation.accepted',
    'tenant.invitation.expired',
    'tenant.invitation.revoked',
    'tenant.member.invited',
    'tenant.member.activated',
    'tenant.member.deactivated',
    'tenant.member.revoked',
    'tenant.member.role_changed',
    'tenant.member.scope_changed',
  ] as const) {
    dispatcher.subscribe(eventType, async () => {
      logger.info({ eventType }, 'Domain event dispatched');
    });
  }
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;

  const relay = async (): Promise<void> => {
    while (true) {
      if (stopping) break;
      try {
        // Start each batch after the previous one settles to keep polling bounded.
        // oxlint-disable-next-line no-await-in-loop
        const ids = await outbox.pendingIds(new Date(), leaseMs, batchSize);
        // Claim and dispatch in order to preserve the outbox's delivery sequence.
        // oxlint-disable no-await-in-loop
        for (const id of ids) {
          const message = await outbox.claim(id, workerId, { leaseMs, maxAttempts });
          if (!message) continue;
          try {
            await dispatcher.dispatch(message.event);
            await outbox.markDelivered(message);
            logger.info({ eventType: message.event.type }, 'Outbox event handled');
          } catch (error) {
            try {
              await outbox.markFailed(message, error, maxAttempts);
            } catch (recordError) {
              logger.error(
                { err: recordError, eventId: message.id },
                'Could not record outbox delivery failure',
              );
            }
          }
        }
        // oxlint-enable no-await-in-loop
        const tenantsToProcess = await database.db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.active, true))
          .orderBy(tenants.id);
        // Each tenant is isolated so one failure cannot block other tenant schedules.
        // oxlint-disable no-await-in-loop
        for (const tenant of tenantsToProcess) {
          try {
            const result = await recurrenceScheduler.runRecurringTaskScheduler(tenant.id, workerId);
            if (result.tasksCreated > 0) {
              logger.info(
                { tasksCreated: result.tasksCreated },
                'Recurring Operations tasks generated',
              );
            }
          } catch (error) {
            logger.error(
              {
                tenantId: tenant.id,
                errorName: safeErrorName(error),
              },
              'Recurring Operations evaluation failed',
            );
          }
          try {
            const deadlineResult = await deadlineScheduler.run(tenant.id, workerId);
            if (deadlineResult.tasksCreated > 0) {
              logger.info(
                { tasksCreated: deadlineResult.tasksCreated },
                'Agreement deadline Operations tasks generated',
              );
            }
            if ('remindersTriggered' in deadlineResult && deadlineResult.remindersTriggered > 0) {
              logger.info(
                { remindersTriggered: deadlineResult.remindersTriggered },
                'Operations deadline reminders evaluated',
              );
            }
            if ('failedDomains' in deadlineResult && deadlineResult.failedDomains.length > 0) {
              logger.error(
                { tenantId: tenant.id, failedDomains: deadlineResult.failedDomains },
                'Some Operations deadline sources could not be evaluated',
              );
            }
          } catch (error) {
            logger.error(
              {
                tenantId: tenant.id,
                errorName: safeErrorName(error),
              },
              'Agreement deadline Operations evaluation failed',
            );
          }
        }
        // oxlint-enable no-await-in-loop
      } catch (error) {
        logger.error({ err: error }, 'Outbox polling failed');
      }

      if (!stopping) {
        // Wait between completed batches instead of scheduling overlapping polls.
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
      }
    }
  };

  const relayPromise = relay();
  const shutdown = () => {
    stopping = true;
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  try {
    await relayPromise;
  } finally {
    await database.close();
    await stopTelemetry();
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
    ? error.name
    : 'UnknownError';
}

void main();
