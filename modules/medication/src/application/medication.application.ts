import { and, asc, desc, eq, gte, inArray, lte, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { clientRecords } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { employeeRecords } from '@care/employees';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { facilities, isSupportedTimeZone, organizationsTable } from '@care/organizations';
import {
  AuthorizationDeniedError,
  ProfessionalCompetencyDeniedError,
  assertCan,
  authorizeProfessionalOperation,
  type AuthorizationPrincipal,
  type CompetencyPolicyEvaluator,
  type MedicationPermission,
  type ProfessionalOperationAuthorizationRequest,
  type ResourceContext,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { localDateTimeToInstant } from '@care/scheduling';
import { visits, visitAssignments } from '@care/scheduling';
import type { AuditWriter } from '@care/audit';
import { medicationAdministrationCorrections, medicationAdministrationOccurrences, medicationAdministrationRecords, medicationDefinitions, medicationOrderRevisions, medicationOrders } from '../schema';
import {
  assertOrderTransition,
  decimalMilliunits,
  isPositiveDecimal,
  medicationScheduleInstant,
  validateOrderFacts,
  validateSchedule,
  type MedicationOrderFacts,
  type MedicationOrderStatus,
  type MedicationOutcome,
  type MedicationReason,
  type MedicationSchedule,
} from '../domain/medication';

export type MedicationScheduleInput =
  | { type: 'fixed_times'; times: string[] }
  | { type: 'interval'; anchorAt: string; intervalMinutes: number }
  | {
      type: 'as_needed';
      indication: string;
      maximumDoseAmount?: string;
      maximumAdministrations?: number;
      frequencyWindowMinutes?: number;
      minimumIntervalMinutes?: number;
    };

export interface MedicationOrderInput {
  medicationDefinitionId: string;
  doseAmount: string;
  doseUnit: MedicationOrderFacts['doseUnit'];
  route: MedicationOrderFacts['route'];
  instructions: string | null;
  indication: string | null;
  prescriberName: string | null;
  sourceType: MedicationOrderFacts['sourceType'];
  sourceReference: string | null;
  prescribedAt: string | null;
  validFrom: string;
  validUntil: string | null;
  schedule: MedicationScheduleInput;
}

export interface MedicationDefinitionInput {
  name: string;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: MedicationOrderFacts['medicationSnapshot']['dosageForm'];
  route: MedicationOrderFacts['route'];
  manufacturer: string | null;
  externalCode: string | null;
}

export interface AdministrationInput {
  visitId: string;
  outcome: MedicationOutcome;
  actualDoseAmount: string | null;
  actualDoseUnit: MedicationOrderFacts['doseUnit'] | null;
  reasonCode: MedicationReason | null;
  administrationReason: string | null;
  note: string | null;
}

export interface MedicationDateRange {
  from: string;
  until: string;
}

interface MedicationCorrectionView {
  id: string;
  version: number;
  outcome: MedicationOutcome;
  actualDoseAmount: string | null;
  actualDoseUnit: string | null;
  reasonCode: MedicationReason | null;
  administrationReason: string | null;
  note: string | null;
  correctionReason: string;
  correctedByEmployeeId: string;
  correctedByEmployeeName: string;
  correctedAt: Date;
}

export class MedicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'MedicationError';
  }
}

export class MedicationApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly competency: CompetencyPolicyEvaluator<DatabaseTransaction>,
  ) {}

  async listDefinitions(principal: AuthorizationPrincipal, clientId?: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      if (clientId) {
        const client = await this.requireClient(transaction, principal.tenantId, clientId);
        this.authorize(principal, 'medication.read', this.clientResource(client));
      } else {
        this.authorize(principal, 'medication.read', { tenantId: principal.tenantId });
      }
      return transaction
        .select()
        .from(medicationDefinitions)
        .where(eq(medicationDefinitions.tenantId, principal.tenantId))
        .orderBy(asc(medicationDefinitions.name), asc(medicationDefinitions.id));
    });
  }

  async definition(principal: AuthorizationPrincipal, definitionId: string) {
    this.authorize(principal, 'medication.read', { tenantId: principal.tenantId });
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [definition] = await transaction.select().from(medicationDefinitions).where(
        and(eq(medicationDefinitions.tenantId, principal.tenantId), eq(medicationDefinitions.id, definitionId)),
      ).limit(1);
      if (!definition) throw medicationError('MEDICATION_NOT_FOUND', 404);
      return definition;
    });
  }

  async createDefinition(principal: AuthorizationPrincipal, input: MedicationDefinitionInput) {
    this.authorize(principal, 'medication.order.manage', { tenantId: principal.tenantId });
    if (!validDefinition(input)) throw medicationError('MEDICATION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const now = new Date();
      const [definition] = await transaction
        .insert(medicationDefinitions)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          ...input,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return definition!;
    });
  }

  async updateDefinition(
    principal: AuthorizationPrincipal,
    definitionId: string,
    input: Partial<MedicationDefinitionInput> & { status?: 'active' | 'archived' },
  ) {
    this.authorize(principal, 'medication.order.manage', { tenantId: principal.tenantId });
    if (Object.keys(input).length === 0 || !validDefinitionPatch(input)) {
      throw medicationError('MEDICATION_INVALID');
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [definition] = await transaction
        .update(medicationDefinitions)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(medicationDefinitions.tenantId, principal.tenantId),
            eq(medicationDefinitions.id, definitionId),
          ),
        )
        .returning();
      if (!definition) throw medicationError('MEDICATION_NOT_FOUND', 404);
      return definition;
    });
  }

  async listOrders(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal.tenantId, clientId);
      this.authorize(principal, 'medication.read', this.clientResource(client));
      const orders = await transaction
        .select()
        .from(medicationOrders)
        .where(
          and(
            eq(medicationOrders.tenantId, principal.tenantId),
            eq(medicationOrders.clientId, clientId),
          ),
        )
        .orderBy(desc(medicationOrders.updatedAt), asc(medicationOrders.id));
      if (orders.length === 0) return [];
      const revisions = await transaction
        .select()
        .from(medicationOrderRevisions)
        .where(
          and(
            eq(medicationOrderRevisions.tenantId, principal.tenantId),
            inArray(medicationOrderRevisions.orderId, orders.map((order) => order.id)),
          ),
        )
        .orderBy(desc(medicationOrderRevisions.version));
      const latest = new Map<string, (typeof revisions)[number]>();
      for (const revision of revisions) if (!latest.has(revision.orderId)) latest.set(revision.orderId, revision);
      return orders.map((order) => ({ order, currentRevision: latest.get(order.id) ?? null }));
    });
  }

  async orderHistory(principal: AuthorizationPrincipal, orderId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [order] = await transaction
        .select()
        .from(medicationOrders)
        .where(and(eq(medicationOrders.tenantId, principal.tenantId), eq(medicationOrders.id, orderId)))
        .limit(1);
      if (!order) throw medicationError('MEDICATION_ORDER_NOT_FOUND', 404);
      const client = await this.requireClient(transaction, principal.tenantId, order.clientId);
      this.authorize(principal, 'medication.read', this.clientResource(client));
      const revisions = await transaction
        .select()
        .from(medicationOrderRevisions)
        .where(and(eq(medicationOrderRevisions.tenantId, principal.tenantId), eq(medicationOrderRevisions.orderId, orderId)))
        .orderBy(asc(medicationOrderRevisions.version));
      return { order, revisions };
    });
  }

  async createOrder(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: MedicationOrderInput,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal.tenantId, clientId);
      this.authorize(principal, 'medication.order.manage', this.clientResource(client));
      const facts = await this.toFacts(transaction, principal.tenantId, input, client.timezone);
      const now = new Date();
      const orderId = uuidv7();
      const order = {
        id: orderId,
        tenantId: principal.tenantId,
        clientId,
        status: 'draft' as const,
        version: 1,
        createdByUserId: principal.userId,
        createdAt: now,
        updatedAt: now,
      };
      await transaction.insert(medicationOrders).values(order);
      await this.insertRevision(transaction, principal, order, facts, 'draft', now);
      const event = this.event('medication_order.created', 'medication_order', orderId, principal, request, { orderId, clientId, version: 1 });
      await this.record(transaction, principal, request, auditContext, event, 'medication_order.created', orderId, { version: 1 });
      return { order, currentRevision: await this.revision(transaction, principal.tenantId, orderId, 1) };
    });
  }

  async reviseOrder(
    principal: AuthorizationPrincipal,
    orderId: string,
    expectedVersion: number,
    input: MedicationOrderInput,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const order = await this.requireOrder(transaction, principal.tenantId, orderId, true);
      const client = await this.requireClient(transaction, principal.tenantId, order.clientId);
      this.authorize(principal, 'medication.order.manage', this.clientResource(client));
      this.checkVersion(order.version, expectedVersion);
      if (order.status === 'discontinued') throw medicationError('MEDICATION_ORDER_INVALID_STATE', 409);
      const facts = await this.toFacts(transaction, principal.tenantId, input, client.timezone);
      if (order.status === 'active' && !facts.sourceReference?.trim()) throw medicationError('MEDICATION_ORDER_SOURCE_REQUIRED');
      const now = new Date();
      const nextVersion = order.version + 1;
      if (order.status === 'active') await this.cancelPending(transaction, principal.tenantId, orderId);
      await this.insertRevision(transaction, principal, order, facts, order.status, now, nextVersion);
      const [updated] = await transaction
        .update(medicationOrders)
        .set({ version: nextVersion, updatedAt: now })
        .where(and(eq(medicationOrders.tenantId, principal.tenantId), eq(medicationOrders.id, orderId), eq(medicationOrders.version, order.version)))
        .returning();
      if (!updated) throw medicationError('MEDICATION_ORDER_VERSION_CONFLICT', 409);
      const event = this.event('medication_order.changed', 'medication_order', orderId, principal, request, { orderId, clientId: order.clientId, version: nextVersion });
      await this.record(transaction, principal, request, auditContext, event, 'medication_order.changed', orderId, { version: nextVersion });
      return { order: updated, currentRevision: await this.revision(transaction, principal.tenantId, orderId, nextVersion) };
    });
  }

  async transitionOrder(
    principal: AuthorizationPrincipal,
    orderId: string,
    expectedVersion: number,
    nextStatus: MedicationOrderStatus,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const order = await this.requireOrder(transaction, principal.tenantId, orderId, true);
      const client = await this.requireClient(transaction, principal.tenantId, order.clientId);
      this.authorize(principal, 'medication.order.manage', this.clientResource(client));
      this.checkVersion(order.version, expectedVersion);
      try {
        assertOrderTransition(order.status, nextStatus);
      } catch {
        throw medicationError('MEDICATION_ORDER_INVALID_STATE', 409);
      }
      const current = await this.revision(transaction, principal.tenantId, orderId, order.version);
      if (!current) throw medicationError('MEDICATION_ORDER_NOT_FOUND', 404);
      if (nextStatus === 'active') {
        const [definition] = await transaction
          .select({ status: medicationDefinitions.status })
          .from(medicationDefinitions)
          .where(and(eq(medicationDefinitions.tenantId, principal.tenantId), eq(medicationDefinitions.id, current.medicationDefinitionId)))
          .limit(1);
        if (!definition || definition.status !== 'active') throw medicationError('MEDICATION_NOT_FOUND', 404);
        if (!current.sourceReference?.trim()) throw medicationError('MEDICATION_ORDER_SOURCE_REQUIRED', 400);
      }
      const now = new Date();
      const nextVersion = order.version + 1;
      const facts = revisionFacts(current);
      await this.insertRevision(transaction, principal, order, facts, nextStatus, now, nextVersion);
      const [updated] = await transaction
        .update(medicationOrders)
        .set({ status: nextStatus, version: nextVersion, updatedAt: now })
        .where(and(eq(medicationOrders.tenantId, principal.tenantId), eq(medicationOrders.id, orderId), eq(medicationOrders.version, order.version)))
        .returning();
      if (!updated) throw medicationError('MEDICATION_ORDER_VERSION_CONFLICT', 409);
      if (order.status === 'active') await this.cancelPending(transaction, principal.tenantId, orderId);
      const eventName = transitionEvent(order.status, nextStatus);
      const event = this.event(eventName, 'medication_order', orderId, principal, request, { orderId, clientId: order.clientId, version: nextVersion });
      await this.record(transaction, principal, request, auditContext, event, eventName, orderId, { version: nextVersion });
      return { order: updated, currentRevision: await this.revision(transaction, principal.tenantId, orderId, nextVersion) };
    });
  }

  async administrationsForClient(
    principal: AuthorizationPrincipal,
    clientId: string,
    range: MedicationDateRange,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal.tenantId, clientId);
      this.authorize(principal, 'medication.read', this.clientResource(client));
      validateDateRange(range);
      const bounds = localDayBounds(range.from, range.until, client.timezone);
      await this.generateOccurrences(transaction, principal.tenantId, clientId, range.from, range.until);
      const occurrences = await transaction
        .select({ occurrence: medicationAdministrationOccurrences, revision: medicationOrderRevisions })
        .from(medicationAdministrationOccurrences)
        .innerJoin(medicationOrderRevisions, and(eq(medicationOrderRevisions.tenantId, medicationAdministrationOccurrences.tenantId), eq(medicationOrderRevisions.id, medicationAdministrationOccurrences.orderRevisionId)))
        .where(and(
          eq(medicationAdministrationOccurrences.tenantId, principal.tenantId),
          eq(medicationAdministrationOccurrences.clientId, clientId),
          gte(medicationAdministrationOccurrences.localDate, range.from),
          lte(medicationAdministrationOccurrences.localDate, range.until),
          eq(medicationAdministrationOccurrences.status, 'pending'),
        ))
        .orderBy(asc(medicationAdministrationOccurrences.scheduledAt));
      const records = await transaction
        .select({
          record: medicationAdministrationRecords,
          revision: medicationOrderRevisions,
          employeeName: sql<string>`coalesce(${employeeRecords.preferredName}, ${employeeRecords.firstName}) || ' ' || ${employeeRecords.lastName}`,
          scheduledAt: medicationAdministrationOccurrences.scheduledAt,
          scheduledTimezone: medicationAdministrationOccurrences.scheduledTimezone,
        })
        .from(medicationAdministrationRecords)
        .innerJoin(medicationOrderRevisions, and(eq(medicationOrderRevisions.tenantId, medicationAdministrationRecords.tenantId), eq(medicationOrderRevisions.id, medicationAdministrationRecords.orderRevisionId)))
        .innerJoin(employeeRecords, and(eq(employeeRecords.tenantId, medicationAdministrationRecords.tenantId), eq(employeeRecords.id, medicationAdministrationRecords.administeredByEmployeeId)))
        .leftJoin(medicationAdministrationOccurrences, and(eq(medicationAdministrationOccurrences.tenantId, medicationAdministrationRecords.tenantId), eq(medicationAdministrationOccurrences.id, medicationAdministrationRecords.occurrenceId)))
        .where(and(
          eq(medicationAdministrationRecords.tenantId, principal.tenantId),
          eq(medicationAdministrationRecords.clientId, clientId),
          gte(medicationAdministrationRecords.occurredAt, bounds.from),
          lt(medicationAdministrationRecords.occurredAt, bounds.until),
        ))
        .orderBy(desc(medicationAdministrationRecords.occurredAt));
      const correctionHistory = await this.correctionHistory(transaction, principal.tenantId, records.map((row) => row.record.id));
      const now = new Date();
      const due = occurrences.map(({ occurrence, revision }) => ({
        occurrenceId: occurrence.id,
        orderId: occurrence.orderId,
        orderVersion: occurrence.orderVersion,
        scheduledAt: occurrence.scheduledAt,
        timezone: occurrence.scheduledTimezone,
        localDate: occurrence.localDate,
        localTime: occurrence.localTime,
        status: occurrence.scheduledAt < now ? 'overdue_not_documented' as const : 'due' as const,
        medication: revision.medicationSnapshot,
        orderedDose: { amount: revision.doseAmount, unit: revision.doseUnit },
        route: revision.route,
      }));
      const history = records.map(({ record, revision, employeeName, scheduledAt, scheduledTimezone }) => {
        const corrections = correctionHistory.get(record.id) ?? [];
        return {
          id: record.id,
          orderId: record.orderId,
          orderVersion: record.orderVersion,
          occurrenceId: record.occurrenceId,
          visitId: record.visitId,
          outcome: record.outcome,
          orderedDose: { amount: record.orderedDoseAmount, unit: record.orderedDoseUnit },
          actualDose: record.actualDoseAmount && record.actualDoseUnit
            ? { amount: record.actualDoseAmount, unit: record.actualDoseUnit }
            : null,
          route: record.route,
          reasonCode: record.reasonCode,
          administrationReason: record.administrationReason,
          note: record.note,
          administeredByEmployeeName: employeeName,
          occurredAt: record.occurredAt,
          capturedAt: record.capturedAt,
          scheduledAt,
          scheduledTimezone,
          medication: revision.medicationSnapshot,
          currentCorrection: corrections.at(-1) ?? null,
          corrections,
        };
      });
      return { due, history };
    });
  }

  async administrationsForVisit(principal: AuthorizationPrincipal, visitId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const visit = await this.requireVisit(transaction, principal.tenantId, visitId);
      const resource = this.clientResource(visit.client);
      const employee = await this.requireAssignedEmployee(transaction, principal, visit.id);
      this.authorize(principal, 'medication.administration.read', { ...resource, assignedUserIds: [principal.userId] });
      const clientLocalDate = localDateFor(visit.plannedStart, visit.client.timezone);
      const occurrenceFrom = addDays(clientLocalDate, -2);
      const occurrenceUntil = addDays(clientLocalDate, 2);
      await this.generateOccurrences(transaction, principal.tenantId, visit.client.id, occurrenceFrom, occurrenceUntil);
      const due = await transaction
        .select({ occurrence: medicationAdministrationOccurrences, revision: medicationOrderRevisions })
        .from(medicationAdministrationOccurrences)
        .innerJoin(medicationOrderRevisions, and(eq(medicationOrderRevisions.tenantId, medicationAdministrationOccurrences.tenantId), eq(medicationOrderRevisions.id, medicationAdministrationOccurrences.orderRevisionId)))
        .where(and(
          eq(medicationAdministrationOccurrences.tenantId, principal.tenantId),
          eq(medicationAdministrationOccurrences.clientId, visit.client.id),
          gte(medicationAdministrationOccurrences.localDate, occurrenceFrom),
          lte(medicationAdministrationOccurrences.localDate, occurrenceUntil),
          eq(medicationAdministrationOccurrences.status, 'pending'),
        ))
        .orderBy(asc(medicationAdministrationOccurrences.scheduledAt));
      const prnOrders = await transaction
        .select({ order: medicationOrders, revision: medicationOrderRevisions })
        .from(medicationOrders)
        .innerJoin(medicationOrderRevisions, and(eq(medicationOrderRevisions.tenantId, medicationOrders.tenantId), eq(medicationOrderRevisions.orderId, medicationOrders.id), eq(medicationOrderRevisions.version, medicationOrders.version)))
        .where(and(
          eq(medicationOrders.tenantId, principal.tenantId),
          eq(medicationOrders.clientId, visit.client.id),
          eq(medicationOrders.status, 'active'),
        ));
      const visitRecords = await transaction
        .select({
          record: medicationAdministrationRecords,
          revision: medicationOrderRevisions,
          employeeName: sql<string>`coalesce(${employeeRecords.preferredName}, ${employeeRecords.firstName}) || ' ' || ${employeeRecords.lastName}`,
          scheduledAt: medicationAdministrationOccurrences.scheduledAt,
          scheduledTimezone: medicationAdministrationOccurrences.scheduledTimezone,
        })
        .from(medicationAdministrationRecords)
        .innerJoin(medicationOrderRevisions, and(eq(medicationOrderRevisions.tenantId, medicationAdministrationRecords.tenantId), eq(medicationOrderRevisions.id, medicationAdministrationRecords.orderRevisionId)))
        .innerJoin(employeeRecords, and(eq(employeeRecords.tenantId, medicationAdministrationRecords.tenantId), eq(employeeRecords.id, medicationAdministrationRecords.administeredByEmployeeId)))
        .leftJoin(medicationAdministrationOccurrences, and(eq(medicationAdministrationOccurrences.tenantId, medicationAdministrationRecords.tenantId), eq(medicationAdministrationOccurrences.id, medicationAdministrationRecords.occurrenceId)))
        .where(and(eq(medicationAdministrationRecords.tenantId, principal.tenantId), eq(medicationAdministrationRecords.visitId, visitId)))
        .orderBy(desc(medicationAdministrationRecords.occurredAt));
      const visitCorrections = await this.correctionHistory(transaction, principal.tenantId, visitRecords.map(({ record }) => record.id));
      return {
        visitId,
        clientId: visit.client.id,
        employeeId: employee.id,
        due: due.filter(({ occurrence }) =>
          occurrence.localDate === localDateFor(visit.plannedStart, occurrence.scheduledTimezone),
        ).map(({ occurrence, revision }) => ({
          occurrenceId: occurrence.id,
          orderId: occurrence.orderId,
          orderVersion: occurrence.orderVersion,
          scheduledAt: occurrence.scheduledAt,
          timezone: occurrence.scheduledTimezone,
          localDate: occurrence.localDate,
          localTime: occurrence.localTime,
          status: occurrence.scheduledAt < new Date() ? 'overdue_not_documented' as const : 'due' as const,
          medication: revision.medicationSnapshot,
          orderedDose: { amount: revision.doseAmount, unit: revision.doseUnit },
          route: revision.route,
          instructions: revision.instructions,
        })),
        history: visitRecords.map(({ record, revision, employeeName, scheduledAt, scheduledTimezone }) => {
          const corrections = visitCorrections.get(record.id) ?? [];
          return {
            id: record.id,
            orderId: record.orderId,
            orderVersion: record.orderVersion,
            occurrenceId: record.occurrenceId,
            visitId: record.visitId,
            outcome: record.outcome,
            orderedDose: { amount: record.orderedDoseAmount, unit: record.orderedDoseUnit },
            actualDose: record.actualDoseAmount && record.actualDoseUnit
              ? { amount: record.actualDoseAmount, unit: record.actualDoseUnit }
              : null,
            route: record.route,
            reasonCode: record.reasonCode,
            administrationReason: record.administrationReason,
            note: record.note,
            administeredByEmployeeName: employeeName,
            occurredAt: record.occurredAt,
            capturedAt: record.capturedAt,
            scheduledAt,
            scheduledTimezone,
            medication: revision.medicationSnapshot,
            currentCorrection: corrections.at(-1) ?? null,
            corrections,
          };
        }),
        prn: prnOrders
          .filter(({ revision }) => {
            if (revision.schedule.type !== 'as_needed') return false;
            const orderLocalDate = localDateFor(visit.plannedStart, revision.schedule.timezone);
            return orderLocalDate >= revision.validFrom && (!revision.validUntil || orderLocalDate <= revision.validUntil);
          })
          .map(({ order, revision }) => ({
            orderId: order.id,
            orderVersion: order.version,
            medication: revision.medicationSnapshot,
            orderedDose: { amount: revision.doseAmount, unit: revision.doseUnit },
            route: revision.route,
            instructions: revision.instructions,
            indication: (revision.schedule as Extract<MedicationSchedule, { type: 'as_needed' }>).indication,
          })),
      };
    });
  }

  async recordOccurrence(
    principal: AuthorizationPrincipal,
    occurrenceId: string,
    input: AdministrationInput,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const observedOccurrence = await this.requireOccurrence(transaction, principal.tenantId, occurrenceId);
      const order = await this.requireOrder(transaction, principal.tenantId, observedOccurrence.orderId, true);
      const occurrence = await this.requireOccurrence(transaction, principal.tenantId, occurrenceId, true);
      if (occurrence.orderId !== order.id) throw medicationError('MEDICATION_ADMINISTRATION_NOT_FOUND', 404);
      if (occurrence.status === 'recorded') throw medicationError('MEDICATION_ADMINISTRATION_ALREADY_RECORDED', 409);
      if (order.status !== 'active' || order.version !== occurrence.orderVersion || occurrence.status !== 'pending') {
        throw medicationError('MEDICATION_ORDER_NOT_ACTIVE', 409);
      }
      return this.recordAgainstOrder(transaction, principal, order, occurrence.orderRevisionId, occurrence.orderVersion, occurrence, input, request, auditContext);
    });
  }

  async recordPrn(
    principal: AuthorizationPrincipal,
    orderId: string,
    input: AdministrationInput,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const order = await this.requireOrder(transaction, principal.tenantId, orderId, true);
      if (order.status !== 'active') throw medicationError('MEDICATION_ORDER_NOT_ACTIVE', 409);
      const revision = await this.revision(transaction, principal.tenantId, order.id, order.version);
      if (!revision || revision.schedule.type !== 'as_needed') throw medicationError('MEDICATION_SCHEDULE_INVALID', 400);
      return this.recordAgainstOrder(transaction, principal, order, revision.id, order.version, null, input, request, auditContext);
    });
  }

  async correctAdministration(
    principal: AuthorizationPrincipal,
    recordId: string,
    input: { outcome: MedicationOutcome; actualDoseAmount: string | null; actualDoseUnit: MedicationOrderFacts['doseUnit'] | null; reasonCode: MedicationReason | null; administrationReason: string | null; note: string | null; correctionReason: string },
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    if (!input.correctionReason.trim() || input.correctionReason.length > 1000 || (input.note?.length ?? 0) > 2000 || (input.administrationReason?.length ?? 0) > 1000) throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [record] = await transaction
        .select()
        .from(medicationAdministrationRecords)
        .where(and(eq(medicationAdministrationRecords.tenantId, principal.tenantId), eq(medicationAdministrationRecords.id, recordId)))
        .limit(1);
      if (!record) throw medicationError('MEDICATION_ADMINISTRATION_NOT_FOUND', 404);
      // Serialize append-only corrections on the owning order, which is mutable and lockable.
      await this.requireOrder(transaction, principal.tenantId, record.orderId, true);
      const client = await this.requireClient(transaction, principal.tenantId, record.clientId);
      const resource = { ...this.clientResource(client), type: 'medication_administration', id: record.id };
      const competency = await this.authorizeProfessionalOperation(transaction, principal, {
        permission: 'medication.administration.correct',
        operation: 'medication.administration.correct',
        resource,
      });
      const latest = await transaction
        .select({ version: medicationAdministrationCorrections.version })
        .from(medicationAdministrationCorrections)
        .where(and(eq(medicationAdministrationCorrections.tenantId, principal.tenantId), eq(medicationAdministrationCorrections.recordId, recordId)))
        .orderBy(desc(medicationAdministrationCorrections.version))
        .limit(1);
    if (!validOutcome(input.outcome, input.actualDoseAmount, input.actualDoseUnit, input.reasonCode)) {
        throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
      }
    if (input.outcome === 'administered' &&
        (!sameDecimal(input.actualDoseAmount!, record.orderedDoseAmount) || input.actualDoseUnit !== record.orderedDoseUnit)) {
      throw medicationError('MEDICATION_ADMINISTRATION_INVALID_DOSE');
    }
      const now = new Date();
      const correction = {
        id: uuidv7(),
        tenantId: principal.tenantId,
        recordId,
        version: (latest[0]?.version ?? 0) + 1,
        ...input,
        correctedByEmployeeId: competency.employeeId,
        correctedAt: now,
      };
      await transaction.insert(medicationAdministrationCorrections).values(correction);
      const event = this.event('medication_administration.corrected', 'medication_administration', recordId, principal, request, { recordId, correctionId: correction.id, clientId: record.clientId, orderId: record.orderId, version: correction.version });
      await this.record(transaction, principal, request, auditContext, event, 'medication_administration.corrected', recordId, { correctionId: correction.id, version: correction.version });
      return correction;
    });
  }

  private async recordAgainstOrder(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    order: typeof medicationOrders.$inferSelect,
    revisionId: string,
    version: number,
    occurrence: typeof medicationAdministrationOccurrences.$inferSelect | null,
    input: AdministrationInput,
    request: RequestContext,
    auditContext: { ip?: string; userAgent?: string },
  ) {
    const revision = await this.revision(transaction, principal.tenantId, order.id, version);
    if (!revision || revision.id !== revisionId || revision.status !== 'active') throw medicationError('MEDICATION_ORDER_NOT_ACTIVE', 409);
    if (!validOutcome(input.outcome, input.actualDoseAmount, input.actualDoseUnit, input.reasonCode) ||
        (input.note?.length ?? 0) > 2000 || (input.administrationReason?.length ?? 0) > 1000) {
      throw medicationError('MEDICATION_ADMINISTRATION_INVALID_OUTCOME');
    }
    if (input.outcome === 'administered' &&
        (!sameDecimal(input.actualDoseAmount!, revision.doseAmount) || input.actualDoseUnit !== revision.doseUnit)) {
      throw medicationError('MEDICATION_ADMINISTRATION_INVALID_DOSE');
    }
    if (occurrence && occurrence.scheduledAt > new Date()) throw medicationError('MEDICATION_ADMINISTRATION_NOT_DUE', 409);
    if (!occurrence && revision.schedule.type !== 'as_needed') throw medicationError('MEDICATION_SCHEDULE_INVALID');
    if (!occurrence && !input.administrationReason?.trim()) throw medicationError('MEDICATION_PRN_REASON_REQUIRED');
    if (!isWithinValidity(revision, occurrence?.localDate ?? localDateFor(new Date(), revision.schedule.timezone))) {
      throw medicationError('MEDICATION_ORDER_NOT_ACTIVE', 409);
    }
    const visit = await this.requireVisit(transaction, principal.tenantId, input.visitId);
    if (visit.client.id !== order.clientId) throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 403);
    const employee = await this.requireAssignedEmployee(transaction, principal, visit.id);
    const resource = { ...this.clientResource(visit.client), assignedUserIds: [principal.userId], type: 'medication_administration', id: occurrence?.id ?? order.id };
    const competency = await this.authorizeProfessionalOperation(transaction, principal, {
      permission: 'medication.administer',
      operation: 'medication.administer',
      resource,
    });
    if (competency.employeeId !== employee.id) throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 403);
    if (!occurrence) await this.validatePrnLimits(transaction, principal.tenantId, order.id, revision, input);
    if (occurrence) {
      const [existing] = await transaction
        .select({ id: medicationAdministrationRecords.id })
        .from(medicationAdministrationRecords)
        .where(and(eq(medicationAdministrationRecords.tenantId, principal.tenantId), eq(medicationAdministrationRecords.occurrenceId, occurrence.id)))
        .limit(1);
      if (existing) throw medicationError('MEDICATION_ADMINISTRATION_ALREADY_RECORDED', 409);
    }
    const now = new Date();
    const record = {
      id: uuidv7(),
      tenantId: principal.tenantId,
      clientId: order.clientId,
      orderId: order.id,
      orderRevisionId: revision.id,
      orderVersion: version,
      occurrenceId: occurrence?.id ?? null,
      visitId: visit.id,
      outcome: input.outcome,
      orderedDoseAmount: revision.doseAmount,
      orderedDoseUnit: revision.doseUnit,
      route: revision.route,
      actualDoseAmount: input.outcome === 'administered' ? input.actualDoseAmount : null,
      actualDoseUnit: input.outcome === 'administered' ? input.actualDoseUnit : null,
      reasonCode: input.reasonCode,
      administrationReason: input.administrationReason,
      note: input.note,
      administeredByEmployeeId: competency.employeeId,
      occurredAt: now,
      capturedAt: now,
    };
    const [created] = await transaction.insert(medicationAdministrationRecords).values(record).returning();
    if (occurrence) {
      await transaction.update(medicationAdministrationOccurrences)
        .set({ status: 'recorded' })
        .where(and(
          eq(medicationAdministrationOccurrences.tenantId, principal.tenantId),
          eq(medicationAdministrationOccurrences.id, occurrence.id),
          eq(medicationAdministrationOccurrences.status, 'pending'),
        ));
    }
    const event = this.event('medication_administration.recorded', 'medication_administration', created!.id, principal, request, { recordId: created!.id, clientId: order.clientId, orderId: order.id });
    await this.record(transaction, principal, request, auditContext, event, 'medication_administration.recorded', created!.id, { orderId: order.id, visitId: visit.id });
    return created!;
  }

  private async validatePrnLimits(
    transaction: DatabaseTransaction,
    tenantId: string,
    orderId: string,
    revision: typeof medicationOrderRevisions.$inferSelect,
    input: AdministrationInput,
  ) {
    if (revision.schedule.type !== 'as_needed') throw medicationError('MEDICATION_SCHEDULE_INVALID');
    const schedule = revision.schedule;
    if (input.outcome !== 'administered') return;
    if (schedule.maximumDoseAmount && decimalMilliunits(input.actualDoseAmount!) > decimalMilliunits(schedule.maximumDoseAmount)) {
      throw medicationError('MEDICATION_PRN_LIMIT_EXCEEDED', 409);
    }
    const rows = await transaction
      .select({ record: medicationAdministrationRecords })
      .from(medicationAdministrationRecords)
      .innerJoin(medicationOrderRevisions, and(
        eq(medicationOrderRevisions.tenantId, medicationAdministrationRecords.tenantId),
        eq(medicationOrderRevisions.id, medicationAdministrationRecords.orderRevisionId),
        eq(medicationOrderRevisions.medicationDefinitionId, revision.medicationDefinitionId),
      ))
      .where(and(eq(medicationAdministrationRecords.tenantId, tenantId), eq(medicationAdministrationRecords.orderId, orderId)))
      .orderBy(desc(medicationAdministrationRecords.occurredAt));
    const records = rows.map(({ record }) => record);
    if (records.length === 0) return;
    const corrections = await this.correctedRecords(transaction, tenantId, records.map((record) => record.id));
    const administered = records.filter((record) => (corrections.get(record.id)?.outcome ?? record.outcome) === 'administered');
    const now = new Date();
    if (schedule.minimumIntervalMinutes !== undefined) {
      const latest = administered[0];
      if (latest && now.getTime() - latest.occurredAt.getTime() < schedule.minimumIntervalMinutes * 60_000) {
        throw medicationError('MEDICATION_PRN_LIMIT_EXCEEDED', 409);
      }
    }
    if (schedule.maximumAdministrations !== undefined && schedule.frequencyWindowMinutes !== undefined) {
      const since = now.getTime() - schedule.frequencyWindowMinutes * 60_000;
      const count = administered.filter((record) => record.occurredAt.getTime() >= since).length;
      if (count >= schedule.maximumAdministrations) throw medicationError('MEDICATION_PRN_LIMIT_EXCEEDED', 409);
    }
  }

  private async generateOccurrences(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    from: string,
    until: string,
  ) {
    validateDateRange({ from, until });
    const activeOrderRows = await transaction
      .select()
      .from(medicationOrders)
      .where(and(eq(medicationOrders.tenantId, tenantId), eq(medicationOrders.clientId, clientId), eq(medicationOrders.status, 'active')))
      .for('share');
    const activeOrders = activeOrderRows.length === 0 ? [] : await transaction
      .select({ order: medicationOrders, revision: medicationOrderRevisions })
      .from(medicationOrders)
      .innerJoin(medicationOrderRevisions, and(
        eq(medicationOrderRevisions.tenantId, medicationOrders.tenantId),
        eq(medicationOrderRevisions.orderId, medicationOrders.id),
        eq(medicationOrderRevisions.version, medicationOrders.version),
      ))
      .where(and(
        eq(medicationOrders.tenantId, tenantId),
        eq(medicationOrders.clientId, clientId),
        eq(medicationOrders.status, 'active'),
        inArray(medicationOrders.id, activeOrderRows.map((order) => order.id)),
      ));
    const now = new Date();
    const pendingIds = await transaction
      .select({ id: medicationAdministrationOccurrences.id, orderId: medicationAdministrationOccurrences.orderId, revisionId: medicationAdministrationOccurrences.orderRevisionId })
      .from(medicationAdministrationOccurrences)
      .where(and(eq(medicationAdministrationOccurrences.tenantId, tenantId), eq(medicationAdministrationOccurrences.clientId, clientId), eq(medicationAdministrationOccurrences.status, 'pending')));
    const activeKeys = new Set(activeOrders.map(({ order, revision }) => `${order.id}:${revision.id}`));
    for (const stale of pendingIds) {
      if (!activeKeys.has(`${stale.orderId}:${stale.revisionId}`)) {
        await transaction.update(medicationAdministrationOccurrences)
          .set({ status: 'cancelled' })
          .where(and(eq(medicationAdministrationOccurrences.tenantId, tenantId), eq(medicationAdministrationOccurrences.id, stale.id), eq(medicationAdministrationOccurrences.status, 'pending')));
      }
    }
    const pending: Array<typeof medicationAdministrationOccurrences.$inferInsert> = [];
    for (const { order, revision } of activeOrders) {
      const schedule = revision.schedule;
      if (schedule.type === 'as_needed') continue;
      const first = revision.validFrom > from ? revision.validFrom : from;
      const last = revision.validUntil && revision.validUntil < until ? revision.validUntil : until;
      if (first > last) continue;
      const emit = (scheduledAt: Date, localDate: string, localTime: string) => {
        if (pending.length >= 20_000) throw medicationError('MEDICATION_SCHEDULE_INVALID');
        pending.push({
          id: uuidv7(), tenantId, clientId, orderId: order.id, orderRevisionId: revision.id,
          orderVersion: revision.version, scheduledAt, scheduledTimezone: schedule.timezone,
          localDate, localTime, status: 'pending', createdAt: now,
        });
      };
      if (schedule.type === 'fixed_times') {
        for (let day = first; day <= last; day = addDays(day, 1)) {
          for (const time of schedule.times) {
            const scheduledAt = medicationScheduleInstant(day, time, schedule.timezone);
            if (!scheduledAt) throw medicationError('MEDICATION_SCHEDULE_INVALID');
            emit(scheduledAt, day, time);
          }
        }
      } else {
        const intervalMs = schedule.intervalMinutes * 60_000;
        const bounds = localDayBounds(first, last, schedule.timezone);
        const anchor = new Date(schedule.anchorAt).getTime();
        const startIndex = Math.max(0, Math.ceil((bounds.from.getTime() - anchor) / intervalMs));
        const endIndex = Math.floor((bounds.until.getTime() - 1 - anchor) / intervalMs);
        if (endIndex - startIndex > 1600) throw medicationError('MEDICATION_SCHEDULE_INVALID');
        for (let index = startIndex; index <= endIndex; index += 1) {
          const instant = new Date(anchor + index * intervalMs);
          const local = localParts(instant, schedule.timezone);
          if (local.date >= first && local.date <= last) emit(instant, local.date, local.time);
        }
      }
    }
    if (pending.length > 20_000) throw medicationError('MEDICATION_SCHEDULE_INVALID');
    if (pending.length > 0) {
      await transaction.insert(medicationAdministrationOccurrences).values(pending).onConflictDoNothing();
    }
  }

  private async toFacts(
    transaction: DatabaseTransaction,
    tenantId: string,
    input: MedicationOrderInput,
    timezone: string,
  ): Promise<MedicationOrderFacts> {
    if (!isPositiveDecimal(input.doseAmount) || !isIsoDate(input.validFrom) ||
        (input.validUntil !== null && !isIsoDate(input.validUntil)) ||
        (input.prescribedAt !== null && !Number.isFinite(new Date(input.prescribedAt).getTime()))) {
      throw medicationError('MEDICATION_ORDER_INVALID');
    }
    const [definition] = await transaction
      .select()
      .from(medicationDefinitions)
      .where(and(eq(medicationDefinitions.tenantId, tenantId), eq(medicationDefinitions.id, input.medicationDefinitionId)))
      .limit(1);
    if (!definition || definition.status !== 'active') throw medicationError('MEDICATION_NOT_FOUND', 404);
    const schedule = { ...input.schedule, timezone } as MedicationSchedule;
    if (!isSupportedTimeZone(timezone) || !validateSchedule(schedule)) throw medicationError('MEDICATION_SCHEDULE_INVALID');
    const facts: MedicationOrderFacts = {
      medicationDefinitionId: definition.id,
      medicationSnapshot: {
        name: definition.name,
        activeIngredient: definition.activeIngredient,
        strength: definition.strength,
        dosageForm: definition.dosageForm as MedicationOrderFacts['medicationSnapshot']['dosageForm'],
        manufacturer: definition.manufacturer,
      },
      doseAmount: input.doseAmount,
      doseUnit: input.doseUnit,
      route: input.route,
      instructions: input.instructions,
      indication: input.indication,
      prescriberName: input.prescriberName,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      prescribedAt: input.prescribedAt,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      schedule,
    };
    if (!validateOrderFacts(facts)) throw medicationError('MEDICATION_ORDER_INVALID');
    return facts;
  }

  private async insertRevision(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    order: { id: string; clientId: string },
    facts: MedicationOrderFacts,
    status: MedicationOrderStatus,
    createdAt: Date,
    version = 1,
  ) {
    await transaction.insert(medicationOrderRevisions).values({
      id: uuidv7(), tenantId: principal.tenantId, orderId: order.id, clientId: order.clientId,
      version, status, ...facts,
      prescribedAt: facts.prescribedAt ? new Date(facts.prescribedAt) : null,
      createdByUserId: principal.userId, createdAt,
    });
  }

  private async revision(transaction: DatabaseTransaction, tenantId: string, orderId: string, version: number) {
    const [revision] = await transaction
      .select()
      .from(medicationOrderRevisions)
      .where(and(eq(medicationOrderRevisions.tenantId, tenantId), eq(medicationOrderRevisions.orderId, orderId), eq(medicationOrderRevisions.version, version)))
      .limit(1);
    return revision ?? null;
  }

  private async requireOrder(transaction: DatabaseTransaction, tenantId: string, orderId: string, lock = false) {
    const query = transaction.select().from(medicationOrders).where(and(eq(medicationOrders.tenantId, tenantId), eq(medicationOrders.id, orderId)));
    const [order] = lock ? await query.for('update').limit(1) : await query.limit(1);
    if (!order) throw medicationError('MEDICATION_ORDER_NOT_FOUND', 404);
    return order;
  }

  private async requireOccurrence(transaction: DatabaseTransaction, tenantId: string, occurrenceId: string, lock = false) {
    const query = transaction.select().from(medicationAdministrationOccurrences).where(and(eq(medicationAdministrationOccurrences.tenantId, tenantId), eq(medicationAdministrationOccurrences.id, occurrenceId)));
    const [occurrence] = lock ? await query.for('update').limit(1) : await query.limit(1);
    if (!occurrence) throw medicationError('MEDICATION_ADMINISTRATION_NOT_FOUND', 404);
    return occurrence;
  }

  private async requireClient(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    const [client] = await transaction
      .select({ id: clientRecords.id, tenantId: clientRecords.tenantId, organizationId: clientRecords.organizationId, primaryFacilityId: clientRecords.primaryFacilityId, facilityTimezone: facilities.timezone, organizationTimezone: organizationsTable.timezone })
      .from(clientRecords)
      .leftJoin(facilities, and(eq(facilities.tenantId, clientRecords.tenantId), eq(facilities.id, clientRecords.primaryFacilityId)))
      .leftJoin(organizationsTable, and(eq(organizationsTable.tenantId, clientRecords.tenantId), eq(organizationsTable.id, clientRecords.organizationId)))
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, clientId)))
      .limit(1);
    if (!client) throw medicationError('MEDICATION_ORDER_NOT_FOUND', 404);
    const timezone = client.facilityTimezone ?? client.organizationTimezone;
    if (!client.organizationId || !client.primaryFacilityId || !timezone) throw medicationError('CLIENT_PROVIDER_CONTEXT_REQUIRED', 409);
    return { ...client, timezone };
  }

  private async requireVisit(transaction: DatabaseTransaction, tenantId: string, visitId: string) {
    const [visit] = await transaction.select().from(visits).where(and(eq(visits.tenantId, tenantId), eq(visits.id, visitId))).for('share').limit(1);
    if (!visit || visit.status === 'cancelled') throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 404);
    const client = await this.requireClient(transaction, tenantId, visit.clientId);
    return { ...visit, client };
  }

  private async requireAssignedEmployee(transaction: DatabaseTransaction, principal: AuthorizationPrincipal, visitId: string) {
    const [employee] = await transaction.select({ id: employeeRecords.id, status: employeeRecords.status })
      .from(employeeRecords)
      .where(and(eq(employeeRecords.tenantId, principal.tenantId), eq(employeeRecords.userId, principal.userId)))
      .for('share').limit(1);
    if (!employee || employee.status !== 'active') throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 403);
    const [assignment] = await transaction.select({ id: visitAssignments.id })
      .from(visitAssignments)
      .where(and(eq(visitAssignments.tenantId, principal.tenantId), eq(visitAssignments.visitId, visitId), eq(visitAssignments.employeeId, employee.id), eq(visitAssignments.status, 'active')))
      .for('share').limit(1);
    if (!assignment) throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 403);
    return employee;
  }

  private async cancelPending(transaction: DatabaseTransaction, tenantId: string, orderId: string) {
    await transaction.update(medicationAdministrationOccurrences)
      .set({ status: 'cancelled' })
      .where(and(eq(medicationAdministrationOccurrences.tenantId, tenantId), eq(medicationAdministrationOccurrences.orderId, orderId), eq(medicationAdministrationOccurrences.status, 'pending')));
  }

  private async correctedRecords(transaction: DatabaseTransaction, tenantId: string, recordIds: string[]) {
    if (recordIds.length === 0) return new Map<string, typeof medicationAdministrationCorrections.$inferSelect>();
    const corrections = await transaction.select().from(medicationAdministrationCorrections)
      .where(and(eq(medicationAdministrationCorrections.tenantId, tenantId), inArray(medicationAdministrationCorrections.recordId, recordIds)))
      .orderBy(desc(medicationAdministrationCorrections.version));
    const latest = new Map<string, (typeof corrections)[number]>();
    for (const correction of corrections) if (!latest.has(correction.recordId)) latest.set(correction.recordId, correction);
    return latest;
  }

  private async correctionHistory(transaction: DatabaseTransaction, tenantId: string, recordIds: string[]) {
    if (recordIds.length === 0) return new Map<string, MedicationCorrectionView[]>();
    const corrections = await transaction.select({
      correction: medicationAdministrationCorrections,
      employeeName: sql<string>`coalesce(${employeeRecords.preferredName}, ${employeeRecords.firstName}) || ' ' || ${employeeRecords.lastName}`,
    }).from(medicationAdministrationCorrections)
      .innerJoin(employeeRecords, and(eq(employeeRecords.tenantId, medicationAdministrationCorrections.tenantId), eq(employeeRecords.id, medicationAdministrationCorrections.correctedByEmployeeId)))
      .where(and(eq(medicationAdministrationCorrections.tenantId, tenantId), inArray(medicationAdministrationCorrections.recordId, recordIds)))
      .orderBy(asc(medicationAdministrationCorrections.version));
    const history = new Map<string, MedicationCorrectionView[]>();
    for (const { correction, employeeName } of corrections) {
      const current = history.get(correction.recordId) ?? [];
      current.push({
        id: correction.id,
        version: correction.version,
        outcome: correction.outcome,
        actualDoseAmount: correction.actualDoseAmount,
        actualDoseUnit: correction.actualDoseUnit,
        reasonCode: correction.reasonCode,
        administrationReason: correction.administrationReason,
        note: correction.note,
        correctionReason: correction.correctionReason,
        correctedByEmployeeId: correction.correctedByEmployeeId,
        correctedByEmployeeName: employeeName,
        correctedAt: correction.correctedAt,
      });
      history.set(correction.recordId, current);
    }
    return history;
  }

  private clientResource(client: { tenantId: string; id: string; organizationId: string | null; primaryFacilityId: string | null }): ResourceContext {
    return { tenantId: client.tenantId, clientId: client.id, ...(client.organizationId ? { organizationId: client.organizationId } : {}), ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}) };
  }

  private authorize(principal: AuthorizationPrincipal, permission: MedicationPermission, resource: ResourceContext) {
    assertCan(principal, { action: permission, resource: { ...resource, tenantId: principal.tenantId } });
  }

  private async authorizeProfessionalOperation(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: ProfessionalOperationAuthorizationRequest,
  ) {
    try {
      return await authorizeProfessionalOperation(transaction, principal, request, this.competency);
    } catch (error) {
      if (error instanceof ProfessionalCompetencyDeniedError) {
        throw medicationError('MEDICATION_COMPETENCY_REQUIRED', 403);
      }
      if (error instanceof AuthorizationDeniedError) {
        throw medicationError('MEDICATION_ADMINISTRATION_NOT_AUTHORIZED', 403);
      }
      throw error;
    }
  }

  private checkVersion(actual: number, expected: number) {
    if (actual !== expected) throw medicationError('MEDICATION_ORDER_VERSION_CONFLICT', 409);
  }

  private event<T extends Parameters<typeof createDomainEvent>[0]['type']>(
    type: T,
    aggregateType: 'medication_order' | 'medication_administration',
    aggregateId: string,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    payload: Record<string, unknown>,
  ) {
    return createDomainEvent({
      type,
      tenantId: principal.tenantId,
      aggregateType,
      aggregateId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload,
    } as never) as DomainEvent;
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    context: { ip?: string; userAgent?: string },
    event: DomainEvent,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.append(transaction, {
      id: event.id, tenantId: principal.tenantId, actorId: principal.userId,
      action, resourceType: event.aggregateType, resourceId,
      timestamp: new Date(event.occurredAt), requestId: request.requestId,
      correlationId: request.correlationId,
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }
}

function medicationError(code: string, status?: number): MedicationError;
function medicationError(code: string, message?: string, status?: number): MedicationError;
function medicationError(code: string, messageOrStatus: string | number = code, status = 400) {
  return new MedicationError(code, typeof messageOrStatus === 'string' ? messageOrStatus : code, typeof messageOrStatus === 'number' ? messageOrStatus : status);
}

function validDefinition(input: MedicationDefinitionInput): boolean {
  return input.name.trim().length > 0 && input.name.length <= 200 &&
    (input.activeIngredient?.length ?? 0) <= 200 && (input.strength?.length ?? 0) <= 120 &&
    (input.manufacturer?.length ?? 0) <= 200 && (input.externalCode?.length ?? 0) <= 100;
}
function validDefinitionPatch(input: Partial<MedicationDefinitionInput> & { status?: 'active' | 'archived' }): boolean {
  return (input.status === undefined || input.status === 'active' || input.status === 'archived') &&
    (input.name === undefined || (input.name.trim().length > 0 && input.name.length <= 200)) &&
    (input.activeIngredient === undefined || (input.activeIngredient?.length ?? 0) <= 200) &&
    (input.strength === undefined || (input.strength?.length ?? 0) <= 120) &&
    (input.manufacturer === undefined || (input.manufacturer?.length ?? 0) <= 200) &&
    (input.externalCode === undefined || (input.externalCode?.length ?? 0) <= 100);
}
function revisionFacts(revision: typeof medicationOrderRevisions.$inferSelect): MedicationOrderFacts {
  return {
    medicationDefinitionId: revision.medicationDefinitionId,
    medicationSnapshot: revision.medicationSnapshot,
    doseAmount: revision.doseAmount,
    doseUnit: revision.doseUnit as MedicationOrderFacts['doseUnit'],
    route: revision.route as MedicationOrderFacts['route'],
    instructions: revision.instructions,
    indication: revision.indication,
    prescriberName: revision.prescriberName,
    sourceType: revision.sourceType as MedicationOrderFacts['sourceType'],
    sourceReference: revision.sourceReference,
    prescribedAt: revision.prescribedAt?.toISOString() ?? null,
    validFrom: revision.validFrom,
    validUntil: revision.validUntil,
    schedule: revision.schedule,
  };
}
function transitionEvent(current: MedicationOrderStatus, status: MedicationOrderStatus): 'medication_order.activated' | 'medication_order.paused' | 'medication_order.resumed' | 'medication_order.discontinued' {
  if (status === 'active') return current === 'paused' ? 'medication_order.resumed' : 'medication_order.activated';
  if (status === 'paused') return 'medication_order.paused';
  return 'medication_order.discontinued';
}
function sameDecimal(left: string, right: string) {
  return decimalMilliunits(left) === decimalMilliunits(right);
}
function validOutcome(outcome: MedicationOutcome, amount: string | null, unit: string | null, reason: MedicationReason | null): boolean {
  if (outcome === 'administered') return amount !== null && isPositiveDecimal(amount) && unit !== null && reason === null;
  return amount === null && unit === null && reason !== null;
}
function isWithinValidity(revision: typeof medicationOrderRevisions.$inferSelect, date: string) {
  return date >= revision.validFrom && (!revision.validUntil || date <= revision.validUntil);
}
function validateDateRange(range: MedicationDateRange) {
  if (!isIsoDate(range.from) || !isIsoDate(range.until) || range.from > range.until || daysBetween(range.from, range.until) > 30) {
    throw medicationError('MEDICATION_DATE_RANGE_INVALID');
  }
}
function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function daysBetween(from: string, until: string) {
  return (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}
function localDayBounds(from: string, until: string, timezone: string) {
  const start = firstInstantOfDay(from, timezone);
  const end = firstInstantOfDay(addDays(until, 1), timezone);
  if (!start || !end) throw medicationError('MEDICATION_SCHEDULE_INVALID');
  return { from: start, until: end };
}
function firstInstantOfDay(day: string, timezone: string) {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const instant = localDateTimeToInstant(day, time, timezone, 'earlier');
    if (instant) return instant;
  }
  return null;
}
function localParts(instant: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
function localDateFor(instant: Date, timezone: string) {
  return localParts(instant, timezone).date;
}
