import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { clientRecords } from '@care/clients';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { employeeRecords } from '@care/employees';
import { createDomainEvent } from '@care/events';
import type { DomainEvent } from '@care/events';
import { facilities, organizationsTable } from '@care/organizations';
import type {
  AuthorizationPrincipal,
  CompetencyPolicyEvaluator,
  Permission,
  ProfessionalOperationAuthorizationRequest,
  ResourceContext,
} from '@care/permissions';
import {
  AuthorizationDeniedError,
  ProfessionalCompetencyDeniedError,
  assertCan,
  authorizeProfessionalOperation,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { AuditWriter } from '@care/audit';
import {
  medicationOrderRevisions,
  medicationOrders,
  medicationReconciliationApplications,
  medicationReconciliationBaselines,
  medicationReconciliationDecisions,
  medicationReconciliationDiscrepancies,
  medicationReconciliationEntries,
  medicationReconciliationMatches,
  medicationReconciliationSources,
  medicationReconciliations,
} from '../schema';
import {
  medicationSourceProvenance,
  sourceMayAuthorizeOrderChange,
  compareMedicationEntry,
  assertReconciliationTransition,
  validateExternalMedicationEntry,
  MEDICATION_RECONCILIATION_REASONS,
  type ExternalMedicationEntryFacts,
  type ExternalMedicationSourceType,
  type MedicationBaselineFacts,
  type MedicationReconciliationDecision,
  type MedicationReconciliationReason,
  type MedicationReconciliationStatus,
  type ReportedMedicationStatus,
} from '../domain/reconciliation';
import type { MedicationSchedule, MedicationOrderStatus } from '../domain/medication';
import { MedicationApplicationService, type MedicationOrderInput } from './medication.application';

type ReconciliationPermission = Extract<Permission, `medication_reconciliation.${string}`>;
type AuditContext = { ip?: string; userAgent?: string };

export interface MedicationReconciliationSourceInput {
  sourceType: ExternalMedicationSourceType;
  sourceName: string | null;
  sourceDate: string | null;
  reference: string | null;
}

export interface MedicationReconciliationEntryInput extends ExternalMedicationEntryFacts {
  sourceId: string;
  supersedesEntryId: string | null;
  correctionReason: string | null;
}

export interface MedicationReconciliationDecisionInput {
  expectedVersion: number;
  discrepancyId: string;
  decision: MedicationReconciliationDecision;
  reason: string | null;
  clarificationOutcome: string | null;
}

export interface MedicationReconciliationApplyInput {
  expectedVersion: number;
  actionId: string;
  items: Array<{
    discrepancyId: string;
    disposition: 'apply_external' | 'not_applied';
    reason: string | null;
  }>;
}

export class MedicationReconciliationError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'MedicationReconciliationError';
  }
}

/** Reconciliation owns source comparison and review; MedicationApplicationService owns every order mutation. */
export class MedicationReconciliationApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly competency: CompetencyPolicyEvaluator<DatabaseTransaction>,
    private readonly medication: MedicationApplicationService,
  ) {}

  async list(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal.tenantId, clientId);
      this.authorize(principal, 'medication_reconciliation.read', this.clientResource(client));
      return transaction
        .select()
        .from(medicationReconciliations)
        .where(
          and(
            eq(medicationReconciliations.tenantId, principal.tenantId),
            eq(medicationReconciliations.clientId, clientId),
          ),
        )
        .orderBy(desc(medicationReconciliations.startedAt), asc(medicationReconciliations.id));
    });
  }

  async get(principal: AuthorizationPrincipal, reconciliationId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const reconciliation = await this.requireReconciliation(
        transaction,
        principal.tenantId,
        reconciliationId,
      );
      const client = await this.requireClient(
        transaction,
        principal.tenantId,
        reconciliation.clientId,
      );
      this.authorize(principal, 'medication_reconciliation.read', this.clientResource(client));
      return this.readAggregate(transaction, reconciliation);
    });
  }

  async start(
    principal: AuthorizationPrincipal,
    clientId: string,
    reason: MedicationReconciliationReason,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!MEDICATION_RECONCILIATION_REASONS.includes(reason))
      throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal.tenantId, clientId);
      this.authorize(principal, 'medication_reconciliation.create', this.clientResource(client));
      const employeeId = await this.requireActiveEmployee(transaction, principal);
      const now = new Date();
      const id = uuidv7();
      const [reconciliation] = await transaction
        .insert(medicationReconciliations)
        .values({
          id,
          tenantId: principal.tenantId,
          clientId,
          status: 'draft',
          reason,
          version: 1,
          inputVersion: 0,
          comparedInputVersion: null,
          comparisonVersion: 0,
          startedByEmployeeId: employeeId,
          reviewedByEmployeeId: null,
          startedAt: now,
          completedAt: null,
          cancellationReason: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const orders = await transaction
        .select()
        .from(medicationOrders)
        .where(
          and(
            eq(medicationOrders.tenantId, principal.tenantId),
            eq(medicationOrders.clientId, clientId),
            inArray(medicationOrders.status, ['active', 'paused']),
          ),
        )
        .orderBy(asc(medicationOrders.id))
        .for('update');
      const currentRevisions = orders.length
        ? await transaction
            .select()
            .from(medicationOrderRevisions)
            .where(
              and(
                eq(medicationOrderRevisions.tenantId, principal.tenantId),
                or(
                  ...orders.map((order) =>
                    and(
                      eq(medicationOrderRevisions.orderId, order.id),
                      eq(medicationOrderRevisions.version, order.version),
                    ),
                  ),
                ),
              ),
            )
        : [];
      const revisionByOrder = new Map(
        currentRevisions.map((revision) => [revision.orderId, revision]),
      );
      const baselines = orders.flatMap((order) => {
        const revision = revisionByOrder.get(order.id);
        if (!revision || revision.status !== order.status) {
          throw reconciliationError('MEDICATION_RECONCILIATION_BASELINE_INVALID', 409);
        }
        const snapshot: MedicationBaselineFacts = {
          orderId: order.id,
          orderRevisionId: revision.id,
          orderVersion: order.version,
          status: order.status,
          medicationSnapshot: {
            name: revision.medicationSnapshot.name,
            activeIngredient: revision.medicationSnapshot.activeIngredient,
            strength: revision.medicationSnapshot.strength,
            dosageForm: revision.medicationSnapshot.dosageForm,
          },
          doseAmount: revision.doseAmount,
          doseUnit: revision.doseUnit as MedicationBaselineFacts['doseUnit'],
          route: revision.route as MedicationBaselineFacts['route'],
          schedule: revision.schedule,
          validFrom: revision.validFrom,
          validUntil: revision.validUntil,
        };
        return [
          {
            id: uuidv7(),
            tenantId: principal.tenantId,
            reconciliationId: id,
            clientId,
            orderId: order.id,
            orderRevisionId: revision.id,
            orderVersion: order.version,
            snapshot,
            createdAt: now,
          },
        ];
      });
      if (baselines.length)
        await transaction.insert(medicationReconciliationBaselines).values(baselines);

      const event = this.event(
        'medication_reconciliation.created',
        'medication_reconciliation',
        id,
        principal,
        request,
        {
          reconciliationId: id,
          clientId,
          version: 1,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.created',
        id,
        { version: 1, baselineCount: baselines.length },
      );
      return { reconciliation: reconciliation!, baselineCount: baselines.length };
    });
  }

  async addSource(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    input: MedicationReconciliationSourceInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validSource(input)) throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation, employeeId } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        expectedVersion,
      );
      this.ensureEditable(reconciliation.status);
      const now = new Date();
      const sourceId = uuidv7();
      const [source] = await transaction
        .insert(medicationReconciliationSources)
        .values({
          id: sourceId,
          tenantId: principal.tenantId,
          reconciliationId,
          clientId: reconciliation.clientId,
          sourceType: input.sourceType,
          provenanceClass: medicationSourceProvenance(input.sourceType),
          sourceName: nullableText(input.sourceName),
          sourceDate: input.sourceDate,
          receivedAt: now,
          recordedByEmployeeId: employeeId,
          reference: nullableText(input.reference),
          createdAt: now,
        })
        .returning();
      const updated = await this.advance(transaction, reconciliation, {
        inputVersion: reconciliation.inputVersion + 1,
      });
      const event = this.event(
        'medication_reconciliation.source_added',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          sourceId,
          version: updated.version,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.source_added',
        reconciliationId,
        { version: updated.version, sourceId },
      );
      return source!;
    });
  }

  async addEntry(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    input: MedicationReconciliationEntryInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validateExternalMedicationEntry(input) || !validEntryCorrection(input)) {
      throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_INVALID');
    }
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation, employeeId } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        expectedVersion,
      );
      this.ensureEditable(reconciliation.status);
      const [source] = await transaction
        .select()
        .from(medicationReconciliationSources)
        .where(
          and(
            eq(medicationReconciliationSources.tenantId, principal.tenantId),
            eq(medicationReconciliationSources.reconciliationId, reconciliationId),
            eq(medicationReconciliationSources.id, input.sourceId),
          ),
        )
        .limit(1);
      if (!source) throw reconciliationError('MEDICATION_RECONCILIATION_SOURCE_NOT_FOUND', 404);

      if (input.supersedesEntryId) {
        const [previous] = await transaction
          .select()
          .from(medicationReconciliationEntries)
          .where(
            and(
              eq(medicationReconciliationEntries.tenantId, principal.tenantId),
              eq(medicationReconciliationEntries.reconciliationId, reconciliationId),
              eq(medicationReconciliationEntries.id, input.supersedesEntryId),
            ),
          )
          .limit(1);
        const [alreadyCorrected] = await transaction
          .select({ id: medicationReconciliationEntries.id })
          .from(medicationReconciliationEntries)
          .where(
            and(
              eq(medicationReconciliationEntries.tenantId, principal.tenantId),
              eq(medicationReconciliationEntries.supersedesEntryId, input.supersedesEntryId),
            ),
          )
          .limit(1);
        if (!previous || previous.sourceId !== source.id || alreadyCorrected) {
          throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_CORRECTION_INVALID', 409);
        }
      }

      const now = new Date();
      const entryId = uuidv7();
      const [entry] = await transaction
        .insert(medicationReconciliationEntries)
        .values({
          id: entryId,
          tenantId: principal.tenantId,
          reconciliationId,
          clientId: reconciliation.clientId,
          sourceId: source.id,
          supersedesEntryId: input.supersedesEntryId,
          correctionReason: nullableText(input.correctionReason),
          medicationName: input.medicationName,
          activeIngredient: input.activeIngredient,
          strength: input.strength,
          dosageForm: input.dosageForm,
          doseAmount: input.doseAmount,
          doseUnit: input.doseUnit,
          route: input.route,
          scheduleDescription: input.scheduleDescription,
          structuredSchedule: input.structuredSchedule,
          reportedStatus: input.reportedStatus,
          note: input.note,
          recordedByEmployeeId: employeeId,
          createdAt: now,
        })
        .returning();
      const updated = await this.advance(transaction, reconciliation, {
        inputVersion: reconciliation.inputVersion + 1,
      });
      const action = input.supersedesEntryId
        ? 'medication_reconciliation.entry_corrected'
        : 'medication_reconciliation.entry_added';
      const event = this.event(
        'medication_reconciliation.entry_added',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          entryId,
          sourceId: source.id,
          version: updated.version,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        action,
        reconciliationId,
        {
          version: updated.version,
          entryId,
          sourceId: source.id,
        },
      );
      return entry!;
    });
  }

  async matchEntry(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    entryId: string,
    baselineId: string | null,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation, employeeId } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        expectedVersion,
      );
      this.ensureEditable(reconciliation.status);
      const [entry] = await transaction
        .select()
        .from(medicationReconciliationEntries)
        .where(
          and(
            eq(medicationReconciliationEntries.tenantId, principal.tenantId),
            eq(medicationReconciliationEntries.reconciliationId, reconciliationId),
            eq(medicationReconciliationEntries.id, entryId),
          ),
        )
        .limit(1);
      if (!entry) throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_NOT_FOUND', 404);
      if (await this.isSuperseded(transaction, principal.tenantId, reconciliationId, entryId)) {
        throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_NOT_CURRENT', 409);
      }
      if (baselineId) {
        const [baseline] = await transaction
          .select({ id: medicationReconciliationBaselines.id })
          .from(medicationReconciliationBaselines)
          .where(
            and(
              eq(medicationReconciliationBaselines.tenantId, principal.tenantId),
              eq(medicationReconciliationBaselines.reconciliationId, reconciliationId),
              eq(medicationReconciliationBaselines.id, baselineId),
            ),
          )
          .limit(1);
        if (!baseline)
          throw reconciliationError('MEDICATION_RECONCILIATION_BASELINE_NOT_FOUND', 404);
      }
      const [previous] = await transaction
        .select()
        .from(medicationReconciliationMatches)
        .where(
          and(
            eq(medicationReconciliationMatches.tenantId, principal.tenantId),
            eq(medicationReconciliationMatches.entryId, entryId),
          ),
        )
        .orderBy(desc(medicationReconciliationMatches.version))
        .limit(1);
      const now = new Date();
      const [match] = await transaction
        .insert(medicationReconciliationMatches)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          reconciliationId,
          clientId: reconciliation.clientId,
          entryId,
          baselineId,
          version: (previous?.version ?? 0) + 1,
          matchedByEmployeeId: employeeId,
          createdAt: now,
        })
        .returning();
      const updated = await this.advance(transaction, reconciliation, {
        inputVersion: reconciliation.inputVersion + 1,
      });
      const event = this.event(
        'medication_reconciliation.reviewed',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          version: updated.version,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.matched',
        reconciliationId,
        { version: updated.version, entryId, baselineId },
      );
      return match!;
    });
  }

  async compare(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        expectedVersion,
      );
      this.ensureEditable(reconciliation.status);
      const sources = await transaction
        .select()
        .from(medicationReconciliationSources)
        .where(
          and(
            eq(medicationReconciliationSources.tenantId, principal.tenantId),
            eq(medicationReconciliationSources.reconciliationId, reconciliationId),
          ),
        );
      const allEntries = await transaction
        .select()
        .from(medicationReconciliationEntries)
        .where(
          and(
            eq(medicationReconciliationEntries.tenantId, principal.tenantId),
            eq(medicationReconciliationEntries.reconciliationId, reconciliationId),
          ),
        );
      const superseded = new Set(
        allEntries.flatMap((entry) => (entry.supersedesEntryId ? [entry.supersedesEntryId] : [])),
      );
      const entries = allEntries.filter((entry) => !superseded.has(entry.id));
      if (sources.length === 0 || entries.length === 0) {
        throw reconciliationError('MEDICATION_RECONCILIATION_SOURCE_OR_ENTRY_REQUIRED', 409);
      }
      const baselines = await transaction
        .select()
        .from(medicationReconciliationBaselines)
        .where(
          and(
            eq(medicationReconciliationBaselines.tenantId, principal.tenantId),
            eq(medicationReconciliationBaselines.reconciliationId, reconciliationId),
          ),
        );
      const matches = await transaction
        .select()
        .from(medicationReconciliationMatches)
        .where(
          and(
            eq(medicationReconciliationMatches.tenantId, principal.tenantId),
            eq(medicationReconciliationMatches.reconciliationId, reconciliationId),
          ),
        )
        .orderBy(desc(medicationReconciliationMatches.version));
      const latestMatch = new Map<string, (typeof matches)[number]>();
      for (const match of matches)
        if (!latestMatch.has(match.entryId)) latestMatch.set(match.entryId, match);
      const baselineById = new Map(baselines.map((baseline) => [baseline.id, baseline]));
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      const matchedBaselineIds = new Set<string>();
      const findings: Array<{
        type: ReturnType<typeof compareMedicationEntry>[number]['type'];
        field: string;
        entryId: string | null;
        baselineId: string | null;
        externalValue: unknown | null;
        internalValue: unknown | null;
      }> = [];

      for (const entry of entries) {
        const match = latestMatch.get(entry.id);
        const baseline = match?.baselineId ? baselineById.get(match.baselineId) : undefined;
        if (!baseline) {
          findings.push({
            type: 'missing_in_internal_plan',
            field: 'medication',
            entryId: entry.id,
            baselineId: null,
            externalValue: entry.medicationName,
            internalValue: null,
          });
          continue;
        }
        matchedBaselineIds.add(baseline.id);
        const source = sourceById.get(entry.sourceId);
        if (!source) throw reconciliationError('MEDICATION_RECONCILIATION_SOURCE_NOT_FOUND', 404);
        const drafts = compareMedicationEntry(entryFacts(entry), {
          ...baseline.snapshot,
          orderId: baseline.orderId,
          orderRevisionId: baseline.orderRevisionId,
          orderVersion: baseline.orderVersion,
        });
        findings.push(
          ...drafts.map((draft) => ({
            ...draft,
            entryId: entry.id,
            baselineId: baseline.id,
          })),
        );
      }
      for (const baseline of baselines) {
        if (!matchedBaselineIds.has(baseline.id))
          findings.push({
            type: 'missing_in_external_source',
            field: 'medication',
            entryId: null,
            baselineId: baseline.id,
            externalValue: null,
            internalValue: baseline.snapshot.medicationSnapshot.name,
          });
      }

      const now = new Date();
      const comparisonVersion = reconciliation.comparisonVersion + 1;
      const updated = await this.advance(transaction, reconciliation, {
        status: 'in_review',
        comparisonVersion,
        comparedInputVersion: reconciliation.inputVersion,
      });
      const discrepancyRows = findings.map((finding) => ({
        id: uuidv7(),
        tenantId: principal.tenantId,
        reconciliationId,
        clientId: reconciliation.clientId,
        comparisonVersion,
        type: finding.type,
        field: finding.field,
        entryId: finding.entryId,
        baselineId: finding.baselineId,
        externalValue: finding.externalValue as never,
        internalValue: finding.internalValue as never,
        createdAt: now,
      }));
      if (discrepancyRows.length)
        await transaction.insert(medicationReconciliationDiscrepancies).values(discrepancyRows);
      const event = this.event(
        'medication_reconciliation.reviewed',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          version: updated.version,
          comparisonVersion,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.compared',
        reconciliationId,
        { version: updated.version, comparisonVersion, discrepancyCount: discrepancyRows.length },
      );
      return { reconciliation: updated, discrepancies: discrepancyRows };
    });
  }

  async decide(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    input: MedicationReconciliationDecisionInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validDecision(input))
      throw reconciliationError('MEDICATION_RECONCILIATION_DECISION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation, employeeId } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        input.expectedVersion,
      );
      this.ensureCurrentComparison(reconciliation);
      const [discrepancy] = await transaction
        .select()
        .from(medicationReconciliationDiscrepancies)
        .where(
          and(
            eq(medicationReconciliationDiscrepancies.tenantId, principal.tenantId),
            eq(medicationReconciliationDiscrepancies.reconciliationId, reconciliationId),
            eq(medicationReconciliationDiscrepancies.id, input.discrepancyId),
            eq(
              medicationReconciliationDiscrepancies.comparisonVersion,
              reconciliation.comparisonVersion,
            ),
          ),
        )
        .limit(1);
      if (!discrepancy)
        throw reconciliationError('MEDICATION_RECONCILIATION_DISCREPANCY_NOT_FOUND', 404);
      const [latest] = await transaction
        .select()
        .from(medicationReconciliationDecisions)
        .where(
          and(
            eq(medicationReconciliationDecisions.tenantId, principal.tenantId),
            eq(medicationReconciliationDecisions.discrepancyId, discrepancy.id),
          ),
        )
        .orderBy(desc(medicationReconciliationDecisions.version))
        .limit(1);
      const [application] = await transaction
        .select({ id: medicationReconciliationApplications.id })
        .from(medicationReconciliationApplications)
        .where(
          and(
            eq(medicationReconciliationApplications.tenantId, principal.tenantId),
            eq(medicationReconciliationApplications.discrepancyId, discrepancy.id),
          ),
        )
        .limit(1);
      if (application) throw reconciliationError('MEDICATION_RECONCILIATION_DECISION_FINAL', 409);
      if (
        latest?.decision === 'requires_clarification' &&
        input.decision !== 'requires_clarification' &&
        !input.clarificationOutcome
      ) {
        throw reconciliationError('MEDICATION_RECONCILIATION_CLARIFICATION_OUTCOME_REQUIRED', 409);
      }
      const now = new Date();
      const [decision] = await transaction
        .insert(medicationReconciliationDecisions)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          reconciliationId,
          clientId: reconciliation.clientId,
          discrepancyId: discrepancy.id,
          version: (latest?.version ?? 0) + 1,
          decision: input.decision,
          reason: nullableText(input.reason),
          clarificationOutcome: nullableText(input.clarificationOutcome),
          reviewedByEmployeeId: employeeId,
          reviewedAt: now,
        })
        .returning();
      const updated = await this.advance(transaction, reconciliation);
      const event = this.event(
        'medication_reconciliation.reviewed',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          version: updated.version,
          comparisonVersion: reconciliation.comparisonVersion,
          discrepancyId: discrepancy.id,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.reviewed',
        reconciliationId,
        { version: updated.version, discrepancyId: discrepancy.id, decision: input.decision },
      );
      return decision!;
    });
  }

  async apply(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    input: MedicationReconciliationApplyInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validApply(input))
      throw reconciliationError('MEDICATION_RECONCILIATION_APPLICATION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const reconciliation = await this.requireReconciliation(
        transaction,
        principal.tenantId,
        reconciliationId,
        true,
      );
      const client = await this.requireClient(
        transaction,
        principal.tenantId,
        reconciliation.clientId,
      );
      this.authorize(principal, 'medication_reconciliation.update', this.clientResource(client));
      const employeeId = await this.requireActiveEmployee(transaction, principal);
      const prior = await transaction
        .select()
        .from(medicationReconciliationApplications)
        .where(
          and(
            eq(medicationReconciliationApplications.tenantId, principal.tenantId),
            eq(medicationReconciliationApplications.reconciliationId, reconciliationId),
            eq(medicationReconciliationApplications.actionId, input.actionId),
          ),
        )
        .orderBy(asc(medicationReconciliationApplications.discrepancyId));
      if (prior.length) {
        if (!sameApplicationRequest(prior, input.items))
          throw reconciliationError('MEDICATION_RECONCILIATION_ACTION_ID_REUSED', 409);
        return { reconciliation, applications: prior, idempotent: true };
      }
      this.checkVersion(reconciliation.version, input.expectedVersion);
      this.ensureCurrentComparison(reconciliation);
      const findings = await transaction
        .select()
        .from(medicationReconciliationDiscrepancies)
        .where(
          and(
            eq(medicationReconciliationDiscrepancies.tenantId, principal.tenantId),
            eq(medicationReconciliationDiscrepancies.reconciliationId, reconciliationId),
            eq(
              medicationReconciliationDiscrepancies.comparisonVersion,
              reconciliation.comparisonVersion,
            ),
          ),
        );
      const findingById = new Map(findings.map((finding) => [finding.id, finding]));
      const decisionRows = await transaction
        .select()
        .from(medicationReconciliationDecisions)
        .where(
          and(
            eq(medicationReconciliationDecisions.tenantId, principal.tenantId),
            eq(medicationReconciliationDecisions.reconciliationId, reconciliationId),
          ),
        )
        .orderBy(desc(medicationReconciliationDecisions.version));
      const latestDecision = new Map<string, (typeof decisionRows)[number]>();
      for (const decision of decisionRows)
        if (!latestDecision.has(decision.discrepancyId))
          latestDecision.set(decision.discrepancyId, decision);

      const existingApps = await transaction
        .select()
        .from(medicationReconciliationApplications)
        .where(
          and(
            eq(medicationReconciliationApplications.tenantId, principal.tenantId),
            eq(medicationReconciliationApplications.reconciliationId, reconciliationId),
          ),
        );
      const existingByDiscrepancy = new Map(
        existingApps.map((application) => [application.discrepancyId, application]),
      );
      for (const item of input.items) {
        const finding = findingById.get(item.discrepancyId);
        if (!finding)
          throw reconciliationError('MEDICATION_RECONCILIATION_DISCREPANCY_NOT_FOUND', 404);
        if (latestDecision.get(finding.id)?.decision !== 'accept_external') {
          throw reconciliationError('MEDICATION_RECONCILIATION_EXTERNAL_DECISION_REQUIRED', 409);
        }
        if (existingByDiscrepancy.has(finding.id))
          throw reconciliationError('MEDICATION_RECONCILIATION_APPLICATION_ALREADY_RECORDED', 409);
        if (item.disposition === 'not_applied' && !item.reason?.trim()) {
          throw reconciliationError('MEDICATION_RECONCILIATION_APPLICATION_REASON_REQUIRED');
        }
      }

      const applyItems = input.items.filter((item) => item.disposition === 'apply_external');
      const appliedOrderByFinding = new Map<
        string,
        Awaited<ReturnType<MedicationApplicationService['reviseOrderInTransaction']>>
      >();
      const touchedBaselineIds = [
        ...new Set(
          applyItems
            .map((item) => findingById.get(item.discrepancyId)?.baselineId)
            .filter((id): id is string => !!id),
        ),
      ];
      const touchedBaselines = touchedBaselineIds.length
        ? await transaction
            .select({
              id: medicationReconciliationBaselines.id,
              orderId: medicationReconciliationBaselines.orderId,
            })
            .from(medicationReconciliationBaselines)
            .where(
              and(
                eq(medicationReconciliationBaselines.tenantId, principal.tenantId),
                inArray(medicationReconciliationBaselines.id, touchedBaselineIds),
              ),
            )
        : [];
      const orderIdByBaseline = new Map(
        touchedBaselines.map((baseline) => [baseline.id, baseline.orderId]),
      );
      for (const [baselineId, items] of groupApplyItems(
        applyItems,
        findingById,
        orderIdByBaseline,
      )) {
        // Keep order locks sequential and deterministic across concurrent reconciliations.
        // oxlint-disable-next-line no-await-in-loop
        const changed = await this.applyBaselineChanges(
          transaction,
          principal,
          reconciliation,
          baselineId,
          items,
          findingById,
          employeeId,
          request,
          auditContext,
        );
        for (const item of items) appliedOrderByFinding.set(item.discrepancyId, changed);
      }

      const now = new Date();
      const applicationRows = input.items.map((item) => {
        const changed = appliedOrderByFinding.get(item.discrepancyId);
        return {
          id: uuidv7(),
          tenantId: principal.tenantId,
          reconciliationId,
          clientId: reconciliation.clientId,
          discrepancyId: item.discrepancyId,
          actionId: input.actionId,
          disposition: changed ? ('applied' as const) : ('not_applied' as const),
          reason: changed ? null : nullableText(item.reason),
          orderId: changed?.order.id ?? null,
          orderRevisionId: changed?.currentRevision?.id ?? null,
          orderVersion: changed?.order.version ?? null,
          appliedByEmployeeId: employeeId,
          appliedAt: now,
        };
      });
      if (applicationRows.length) {
        await transaction.insert(medicationReconciliationApplications).values(applicationRows);
      }
      const updated = await this.advance(transaction, reconciliation);
      const appliedCount = applicationRows.filter(
        (application) => application.disposition === 'applied',
      ).length;
      const notAppliedCount = applicationRows.length - appliedCount;
      const event = appliedCount
        ? this.event(
            'medication_reconciliation.change_applied',
            'medication_reconciliation',
            reconciliationId,
            principal,
            request,
            {
              reconciliationId,
              clientId: reconciliation.clientId,
              actionId: input.actionId,
              version: updated.version,
              applicationCount: appliedCount,
            },
          )
        : this.event(
            'medication_reconciliation.reviewed',
            'medication_reconciliation',
            reconciliationId,
            principal,
            request,
            {
              reconciliationId,
              clientId: reconciliation.clientId,
              version: updated.version,
            },
          );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        appliedCount
          ? 'medication_reconciliation.change_applied'
          : 'medication_reconciliation.change_not_applied',
        reconciliationId,
        {
          version: updated.version,
          actionId: input.actionId,
          appliedCount,
          notAppliedCount,
        },
      );
      return { reconciliation: updated, applications: applicationRows, idempotent: false };
    });
  }

  async complete(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const reconciliation = await this.requireReconciliation(
        transaction,
        principal.tenantId,
        reconciliationId,
        true,
      );
      const client = await this.requireClient(
        transaction,
        principal.tenantId,
        reconciliation.clientId,
      );
      const resource = this.clientResource(client);
      const employeeId = await this.requireActiveEmployee(transaction, principal);
      const authorizationRequest: ProfessionalOperationAuthorizationRequest = {
        permission: 'medication_reconciliation.complete',
        operation: 'medication.reconciliation.complete',
        resource: { ...resource, type: 'client', id: client.id },
      };
      try {
        await authorizeProfessionalOperation(
          transaction,
          principal,
          authorizationRequest,
          this.competency,
        );
      } catch (error) {
        if (error instanceof ProfessionalCompetencyDeniedError) {
          throw reconciliationError('MEDICATION_COMPETENCY_REQUIRED', 403);
        }
        if (error instanceof AuthorizationDeniedError) {
          throw reconciliationError('MEDICATION_RECONCILIATION_NOT_AUTHORIZED', 403);
        }
        throw error;
      }
      this.checkVersion(reconciliation.version, expectedVersion);
      assertReconciliationTransition(reconciliation.status, 'completed');
      this.ensureCurrentComparison(reconciliation);
      const findings = await transaction
        .select()
        .from(medicationReconciliationDiscrepancies)
        .where(
          and(
            eq(medicationReconciliationDiscrepancies.tenantId, principal.tenantId),
            eq(medicationReconciliationDiscrepancies.reconciliationId, reconciliationId),
            eq(
              medicationReconciliationDiscrepancies.comparisonVersion,
              reconciliation.comparisonVersion,
            ),
          ),
        );
      const decisions = await transaction
        .select()
        .from(medicationReconciliationDecisions)
        .where(
          and(
            eq(medicationReconciliationDecisions.tenantId, principal.tenantId),
            eq(medicationReconciliationDecisions.reconciliationId, reconciliationId),
          ),
        )
        .orderBy(desc(medicationReconciliationDecisions.version));
      const latestDecision = new Map<string, (typeof decisions)[number]>();
      for (const decision of decisions)
        if (!latestDecision.has(decision.discrepancyId))
          latestDecision.set(decision.discrepancyId, decision);
      const applications = await transaction
        .select()
        .from(medicationReconciliationApplications)
        .where(
          and(
            eq(medicationReconciliationApplications.tenantId, principal.tenantId),
            eq(medicationReconciliationApplications.reconciliationId, reconciliationId),
          ),
        );
      const applicationByDiscrepancy = new Map(
        applications.map((application) => [application.discrepancyId, application]),
      );
      for (const finding of findings) {
        const decision = latestDecision.get(finding.id);
        if (!decision)
          throw reconciliationError('MEDICATION_RECONCILIATION_DECISION_REQUIRED', 409);
        if (decision.decision === 'requires_clarification') {
          throw reconciliationError('MEDICATION_RECONCILIATION_CLARIFICATION_REQUIRED', 409);
        }
        if (decision.decision === 'accept_external' && !applicationByDiscrepancy.has(finding.id)) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_DISPOSITION_REQUIRED', 409);
        }
      }
      const now = new Date();
      const updated = await this.advance(transaction, reconciliation, {
        status: 'completed',
        reviewedByEmployeeId: employeeId,
        completedAt: now,
      });
      const event = this.event(
        'medication_reconciliation.completed',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          version: updated.version,
          reviewerEmployeeId: employeeId,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.completed',
        reconciliationId,
        { version: updated.version, reviewerEmployeeId: employeeId },
      );
      return updated;
    });
  }

  async cancel(
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
    reason: string | null,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (reason !== null && reason.length > 1000)
      throw reconciliationError('MEDICATION_RECONCILIATION_INVALID');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const { reconciliation } = await this.lockForUpdate(
        transaction,
        principal,
        reconciliationId,
        expectedVersion,
      );
      assertReconciliationTransition(reconciliation.status, 'cancelled');
      const updated = await this.advance(transaction, reconciliation, {
        status: 'cancelled',
        cancellationReason: nullableText(reason),
      });
      const event = this.event(
        'medication_reconciliation.cancelled',
        'medication_reconciliation',
        reconciliationId,
        principal,
        request,
        {
          reconciliationId,
          clientId: reconciliation.clientId,
          version: updated.version,
        },
      );
      await this.record(
        transaction,
        principal,
        request,
        auditContext,
        event,
        'medication_reconciliation.cancelled',
        reconciliationId,
        { version: updated.version },
      );
      return updated;
    });
  }

  private async applyBaselineChanges(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    reconciliation: typeof medicationReconciliations.$inferSelect,
    baselineId: string,
    items: MedicationReconciliationApplyInput['items'],
    findings: Map<string, typeof medicationReconciliationDiscrepancies.$inferSelect>,
    _employeeId: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const [baseline] = await transaction
      .select()
      .from(medicationReconciliationBaselines)
      .where(
        and(
          eq(medicationReconciliationBaselines.tenantId, principal.tenantId),
          eq(medicationReconciliationBaselines.reconciliationId, reconciliation.id),
          eq(medicationReconciliationBaselines.id, baselineId),
        ),
      )
      .limit(1);
    if (!baseline) throw reconciliationError('MEDICATION_RECONCILIATION_BASELINE_NOT_FOUND', 404);
    const [order] = await transaction
      .select()
      .from(medicationOrders)
      .where(
        and(
          eq(medicationOrders.tenantId, principal.tenantId),
          eq(medicationOrders.id, baseline.orderId),
          eq(medicationOrders.clientId, reconciliation.clientId),
        ),
      )
      .for('update')
      .limit(1);
    if (!order || order.version !== baseline.orderVersion) {
      throw reconciliationError('MEDICATION_RECONCILIATION_STALE_ORDER', 409);
    }
    const [revision] = await transaction
      .select()
      .from(medicationOrderRevisions)
      .where(
        and(
          eq(medicationOrderRevisions.tenantId, principal.tenantId),
          eq(medicationOrderRevisions.id, baseline.orderRevisionId),
          eq(medicationOrderRevisions.orderId, baseline.orderId),
          eq(medicationOrderRevisions.version, baseline.orderVersion),
        ),
      )
      .limit(1);
    if (!revision) throw reconciliationError('MEDICATION_RECONCILIATION_BASELINE_INVALID', 409);

    const findingsForItems = items.map((item) => {
      const finding = findings.get(item.discrepancyId);
      if (!finding || finding.baselineId !== baseline.id || !finding.entryId) {
        throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
      }
      if (
        !['dose_mismatch', 'route_mismatch', 'schedule_mismatch', 'status_mismatch'].includes(
          finding.type,
        )
      ) {
        throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
      }
      return { finding, entryId: finding.entryId };
    });
    const entries = await transaction
      .select()
      .from(medicationReconciliationEntries)
      .where(
        and(
          eq(medicationReconciliationEntries.tenantId, principal.tenantId),
          inArray(
            medicationReconciliationEntries.id,
            findingsForItems.map(({ entryId }) => entryId),
          ),
        ),
      );
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    if (entryById.size !== findingsForItems.length) {
      throw reconciliationError('MEDICATION_RECONCILIATION_ENTRY_NOT_FOUND', 404);
    }
    const sourceIds = new Set(entries.map((entry) => entry.sourceId));
    if (sourceIds.size !== 1)
      throw reconciliationError('MEDICATION_RECONCILIATION_MULTIPLE_SOURCES', 409);
    const sourceId = [...sourceIds][0]!;
    const [source] = await transaction
      .select()
      .from(medicationReconciliationSources)
      .where(
        and(
          eq(medicationReconciliationSources.tenantId, principal.tenantId),
          eq(medicationReconciliationSources.id, sourceId),
        ),
      )
      .limit(1);
    if (!source || !sourceMayAuthorizeOrderChange(source.sourceType)) {
      throw reconciliationError('MEDICATION_RECONCILIATION_PROVENANCE_NOT_AUTHORIZED', 403);
    }
    if (!source.reference?.trim())
      throw reconciliationError('MEDICATION_RECONCILIATION_SOURCE_REFERENCE_REQUIRED', 409);

    const patch: {
      doseAmount?: string;
      route?: string;
      schedule?: MedicationSchedule;
      status?: MedicationOrderStatus;
    } = {};
    const scheduleTimezone = findingsForItems.some(
      ({ finding }) => finding.type === 'schedule_mismatch',
    )
      ? (await this.requireClient(transaction, principal.tenantId, reconciliation.clientId))
          .timezone
      : null;
    for (const { finding, entryId } of findingsForItems) {
      const entry = entryById.get(entryId)!;
      if (finding.type === 'dose_mismatch') {
        if (!entry.doseAmount || !entry.doseUnit || entry.doseUnit !== revision.doseUnit) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
        }
        if (patch.doseAmount !== undefined && patch.doseAmount !== entry.doseAmount) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CONFLICTING_EXTERNAL_VALUES', 409);
        }
        patch.doseAmount = entry.doseAmount;
      } else if (finding.type === 'route_mismatch') {
        if (!entry.route)
          throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
        if (patch.route !== undefined && patch.route !== entry.route) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CONFLICTING_EXTERNAL_VALUES', 409);
        }
        patch.route = entry.route;
      } else if (finding.type === 'schedule_mismatch') {
        if (!entry.structuredSchedule || entry.structuredSchedule.timezone !== scheduleTimezone) {
          throw reconciliationError('MEDICATION_RECONCILIATION_SCHEDULE_TIMEZONE_UNSUPPORTED', 409);
        }
        if (
          patch.schedule &&
          JSON.stringify(patch.schedule) !== JSON.stringify(entry.structuredSchedule)
        ) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CONFLICTING_EXTERNAL_VALUES', 409);
        }
        patch.schedule = entry.structuredSchedule;
      } else if (finding.type === 'status_mismatch') {
        const next = reportedStatusToOrderStatus(entry.reportedStatus);
        if (!next)
          throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
        if (patch.status !== undefined && patch.status !== next) {
          throw reconciliationError('MEDICATION_RECONCILIATION_CONFLICTING_EXTERNAL_VALUES', 409);
        }
        patch.status = next;
      }
    }

    let result: Awaited<ReturnType<MedicationApplicationService['reviseOrderInTransaction']>>;
    let currentVersion = order.version;
    if (patch.doseAmount || patch.route || patch.schedule) {
      const schedule = patch.schedule ?? revision.schedule;
      const updatedInput = orderInputFromRevision(revision, {
        doseAmount: patch.doseAmount ?? revision.doseAmount,
        route: patch.route ?? revision.route,
        schedule,
        sourceType: source.sourceType === 'physician' ? 'prescriber' : 'care_authorizing_source',
        sourceReference: source.reference,
      });
      result = await this.medication.reviseOrderInTransaction(
        transaction,
        principal,
        order.id,
        order.version,
        updatedInput,
        request,
        auditContext,
      );
      currentVersion = result.order.version;
    } else {
      result = {
        order,
        currentRevision: revision,
      } as Awaited<ReturnType<MedicationApplicationService['reviseOrderInTransaction']>>;
    }
    if (patch.status && patch.status !== result.order.status) {
      result = await this.medication.transitionOrderInTransaction(
        transaction,
        principal,
        order.id,
        currentVersion,
        patch.status,
        request,
        auditContext,
      );
    }
    if (!result.currentRevision)
      throw reconciliationError('MEDICATION_RECONCILIATION_BASELINE_INVALID', 409);
    return result;
  }

  private async readAggregate(
    transaction: DatabaseTransaction,
    reconciliation: typeof medicationReconciliations.$inferSelect,
  ) {
    const sources = await transaction
      .select()
      .from(medicationReconciliationSources)
      .where(
        and(
          eq(medicationReconciliationSources.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationSources.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(asc(medicationReconciliationSources.receivedAt));
    const entries = await transaction
      .select()
      .from(medicationReconciliationEntries)
      .where(
        and(
          eq(medicationReconciliationEntries.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationEntries.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(asc(medicationReconciliationEntries.createdAt));
    const superseded = new Set(
      entries.flatMap((entry) => (entry.supersedesEntryId ? [entry.supersedesEntryId] : [])),
    );
    const baselines = await transaction
      .select()
      .from(medicationReconciliationBaselines)
      .where(
        and(
          eq(medicationReconciliationBaselines.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationBaselines.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(asc(medicationReconciliationBaselines.createdAt));
    const matches = await transaction
      .select()
      .from(medicationReconciliationMatches)
      .where(
        and(
          eq(medicationReconciliationMatches.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationMatches.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(desc(medicationReconciliationMatches.version));
    const latestMatches = new Map<string, (typeof matches)[number]>();
    for (const match of matches)
      if (!latestMatches.has(match.entryId)) latestMatches.set(match.entryId, match);
    const discrepancies = await transaction
      .select()
      .from(medicationReconciliationDiscrepancies)
      .where(
        and(
          eq(medicationReconciliationDiscrepancies.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationDiscrepancies.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(
        desc(medicationReconciliationDiscrepancies.comparisonVersion),
        asc(medicationReconciliationDiscrepancies.createdAt),
      );
    const decisions = await transaction
      .select()
      .from(medicationReconciliationDecisions)
      .where(
        and(
          eq(medicationReconciliationDecisions.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationDecisions.reconciliationId, reconciliation.id),
        ),
      )
      .orderBy(desc(medicationReconciliationDecisions.version));
    const latestDecisions = new Map<string, (typeof decisions)[number]>();
    const decisionsByDiscrepancy = new Map<string, typeof decisions>();
    for (const decision of decisions) {
      if (!latestDecisions.has(decision.discrepancyId))
        latestDecisions.set(decision.discrepancyId, decision);
      decisionsByDiscrepancy.set(decision.discrepancyId, [
        ...(decisionsByDiscrepancy.get(decision.discrepancyId) ?? []),
        decision,
      ]);
    }
    const applications = await transaction
      .select()
      .from(medicationReconciliationApplications)
      .where(
        and(
          eq(medicationReconciliationApplications.tenantId, reconciliation.tenantId),
          eq(medicationReconciliationApplications.reconciliationId, reconciliation.id),
        ),
      );
    const applicationByDiscrepancy = new Map(
      applications.map((application) => [application.discrepancyId, application]),
    );
    return {
      reconciliation,
      sources,
      entries: entries.map((entry) => ({
        ...entry,
        isCurrent: !superseded.has(entry.id),
        currentMatch: latestMatches.get(entry.id) ?? null,
      })),
      baselines,
      discrepancies: discrepancies.map((discrepancy) => ({
        ...discrepancy,
        isCurrent:
          discrepancy.comparisonVersion === reconciliation.comparisonVersion &&
          reconciliation.comparedInputVersion === reconciliation.inputVersion,
        latestDecision: latestDecisions.get(discrepancy.id) ?? null,
        decisions: decisionsByDiscrepancy.get(discrepancy.id) ?? [],
        application: applicationByDiscrepancy.get(discrepancy.id) ?? null,
      })),
      comparisonCurrent:
        reconciliation.comparisonVersion > 0 &&
        reconciliation.comparedInputVersion === reconciliation.inputVersion,
    };
  }

  private async lockForUpdate(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    reconciliationId: string,
    expectedVersion: number,
  ) {
    const reconciliation = await this.requireReconciliation(
      transaction,
      principal.tenantId,
      reconciliationId,
      true,
    );
    const client = await this.requireClient(
      transaction,
      principal.tenantId,
      reconciliation.clientId,
    );
    this.authorize(principal, 'medication_reconciliation.update', this.clientResource(client));
    this.checkVersion(reconciliation.version, expectedVersion);
    const employeeId = await this.requireActiveEmployee(transaction, principal);
    return { reconciliation, client, employeeId };
  }

  private async advance(
    transaction: DatabaseTransaction,
    current: typeof medicationReconciliations.$inferSelect,
    patch: Partial<typeof medicationReconciliations.$inferInsert> = {},
  ) {
    const [updated] = await transaction
      .update(medicationReconciliations)
      .set({
        ...patch,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(medicationReconciliations.tenantId, current.tenantId),
          eq(medicationReconciliations.id, current.id),
          eq(medicationReconciliations.version, current.version),
        ),
      )
      .returning();
    if (!updated) throw reconciliationError('MEDICATION_RECONCILIATION_VERSION_CONFLICT', 409);
    return updated;
  }

  private async isSuperseded(
    transaction: DatabaseTransaction,
    tenantId: string,
    reconciliationId: string,
    entryId: string,
  ) {
    const [replacement] = await transaction
      .select({ id: medicationReconciliationEntries.id })
      .from(medicationReconciliationEntries)
      .where(
        and(
          eq(medicationReconciliationEntries.tenantId, tenantId),
          eq(medicationReconciliationEntries.reconciliationId, reconciliationId),
          eq(medicationReconciliationEntries.supersedesEntryId, entryId),
        ),
      )
      .limit(1);
    return !!replacement;
  }

  private ensureEditable(status: MedicationReconciliationStatus) {
    if (status !== 'draft' && status !== 'in_review') {
      throw reconciliationError('MEDICATION_RECONCILIATION_INVALID_STATE', 409);
    }
  }

  private ensureCurrentComparison(reconciliation: typeof medicationReconciliations.$inferSelect) {
    if (
      reconciliation.status !== 'in_review' ||
      reconciliation.comparisonVersion === 0 ||
      reconciliation.comparedInputVersion !== reconciliation.inputVersion
    ) {
      throw reconciliationError('MEDICATION_RECONCILIATION_COMPARISON_STALE', 409);
    }
  }

  private async requireClient(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
  ) {
    const [client] = await transaction
      .select({
        id: clientRecords.id,
        tenantId: clientRecords.tenantId,
        organizationId: clientRecords.organizationId,
        primaryFacilityId: clientRecords.primaryFacilityId,
        facilityTimezone: facilities.timezone,
        organizationTimezone: organizationsTable.timezone,
      })
      .from(clientRecords)
      .leftJoin(
        facilities,
        and(
          eq(facilities.tenantId, clientRecords.tenantId),
          eq(facilities.id, clientRecords.primaryFacilityId),
        ),
      )
      .leftJoin(
        organizationsTable,
        and(
          eq(organizationsTable.tenantId, clientRecords.tenantId),
          eq(organizationsTable.id, clientRecords.organizationId),
        ),
      )
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, clientId)))
      .limit(1);
    if (!client) throw reconciliationError('CLIENT_NOT_FOUND', 404);
    const timezone = client.facilityTimezone ?? client.organizationTimezone;
    if (!client.organizationId || !client.primaryFacilityId || !timezone) {
      throw reconciliationError('CLIENT_PROVIDER_CONTEXT_REQUIRED', 409);
    }
    return { ...client, timezone };
  }

  private async requireReconciliation(
    transaction: DatabaseTransaction,
    tenantId: string,
    reconciliationId: string,
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(medicationReconciliations)
      .where(
        and(
          eq(medicationReconciliations.tenantId, tenantId),
          eq(medicationReconciliations.id, reconciliationId),
        ),
      );
    const [reconciliation] = lock ? await query.for('update').limit(1) : await query.limit(1);
    if (!reconciliation) throw reconciliationError('MEDICATION_RECONCILIATION_NOT_FOUND', 404);
    return reconciliation;
  }

  private async requireActiveEmployee(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
  ) {
    const [employee] = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, principal.tenantId),
          eq(employeeRecords.userId, principal.userId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .limit(1);
    if (!employee) throw reconciliationError('MEDICATION_RECONCILIATION_EMPLOYEE_REQUIRED', 403);
    return employee.id;
  }

  private clientResource(client: {
    tenantId: string;
    id: string;
    organizationId: string | null;
    primaryFacilityId: string | null;
  }): ResourceContext {
    return {
      tenantId: client.tenantId,
      clientId: client.id,
      ...(client.organizationId ? { organizationId: client.organizationId } : {}),
      ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
    };
  }

  private authorize(
    principal: AuthorizationPrincipal,
    permission: ReconciliationPermission,
    resource: ResourceContext,
  ) {
    try {
      assertCan(principal, {
        action: permission,
        resource: { ...resource, tenantId: principal.tenantId },
      });
    } catch (error) {
      if (error instanceof AuthorizationDeniedError)
        throw reconciliationError('MEDICATION_RECONCILIATION_NOT_AUTHORIZED', 403);
      throw error;
    }
  }

  private checkVersion(actual: number, expected: number) {
    if (!Number.isInteger(expected) || actual !== expected) {
      throw reconciliationError('MEDICATION_RECONCILIATION_VERSION_CONFLICT', 409);
    }
  }

  private event<T extends Parameters<typeof createDomainEvent>[0]['type']>(
    type: T,
    aggregateType: 'medication_reconciliation',
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
    context: AuditContext,
    event: DomainEvent,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action,
      resourceType: event.aggregateType,
      resourceId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }
}

function entryFacts(
  entry: typeof medicationReconciliationEntries.$inferSelect,
): ExternalMedicationEntryFacts {
  return {
    medicationName: entry.medicationName,
    activeIngredient: entry.activeIngredient,
    strength: entry.strength,
    dosageForm: entry.dosageForm,
    doseAmount: entry.doseAmount,
    doseUnit: entry.doseUnit,
    route: entry.route,
    scheduleDescription: entry.scheduleDescription,
    structuredSchedule: entry.structuredSchedule,
    reportedStatus: entry.reportedStatus as ReportedMedicationStatus,
    note: entry.note,
  };
}

function validSource(input: MedicationReconciliationSourceInput): boolean {
  return input.sourceName === null || input.sourceName.trim().length <= 200
    ? input.reference === null || input.reference.trim().length <= 1000
      ? input.sourceDate === null || isIsoDate(input.sourceDate)
      : false
    : false;
}

function validEntryCorrection(input: MedicationReconciliationEntryInput): boolean {
  return input.supersedesEntryId === null
    ? input.correctionReason === null || input.correctionReason.trim().length === 0
    : !!input.correctionReason?.trim() && input.correctionReason.length <= 1000;
}

function validDecision(input: MedicationReconciliationDecisionInput): boolean {
  return (
    Number.isInteger(input.expectedVersion) &&
    input.expectedVersion > 0 &&
    !!input.discrepancyId &&
    (input.reason === null || input.reason.length <= 1000) &&
    (input.clarificationOutcome === null || input.clarificationOutcome.length <= 2000) &&
    (input.decision !== 'requires_clarification' || !!input.reason?.trim())
  );
}

function validApply(input: MedicationReconciliationApplyInput): boolean {
  return (
    Number.isInteger(input.expectedVersion) &&
    input.expectedVersion > 0 &&
    !!input.actionId &&
    input.items.length > 0 &&
    new Set(input.items.map((item) => item.discrepancyId)).size === input.items.length &&
    input.items.every(
      (item) =>
        item.discrepancyId.length > 0 &&
        (item.disposition === 'apply_external'
          ? item.reason === null
          : !!item.reason?.trim() && item.reason.length <= 1000),
    )
  );
}

function sameApplicationRequest(
  previous: Array<typeof medicationReconciliationApplications.$inferSelect>,
  requested: MedicationReconciliationApplyInput['items'],
): boolean {
  if (previous.length !== requested.length) return false;
  const priorById = new Map(previous.map((row) => [row.discrepancyId, row]));
  return requested.every((item) => {
    const row = priorById.get(item.discrepancyId);
    return (
      !!row &&
      row.disposition === (item.disposition === 'apply_external' ? 'applied' : 'not_applied') &&
      (item.disposition === 'apply_external' || row.reason === item.reason)
    );
  });
}

function groupApplyItems(
  items: MedicationReconciliationApplyInput['items'],
  findings: Map<string, typeof medicationReconciliationDiscrepancies.$inferSelect>,
  orderIdByBaseline: Map<string, string>,
): Map<string, MedicationReconciliationApplyInput['items']> {
  const grouped = new Map<string, MedicationReconciliationApplyInput['items']>();
  for (const item of items) {
    const baselineId = findings.get(item.discrepancyId)?.baselineId;
    if (!baselineId)
      throw reconciliationError('MEDICATION_RECONCILIATION_CHANGE_NOT_APPLICABLE', 409);
    grouped.set(baselineId, [...(grouped.get(baselineId) ?? []), item]);
  }
  return new Map(
    [...grouped.entries()].sort(([left], [right]) =>
      (orderIdByBaseline.get(left) ?? left).localeCompare(orderIdByBaseline.get(right) ?? right),
    ),
  );
}

function orderInputFromRevision(
  revision: typeof medicationOrderRevisions.$inferSelect,
  override: {
    doseAmount: string;
    route: string;
    schedule: MedicationSchedule;
    sourceType: MedicationOrderInput['sourceType'];
    sourceReference: string;
  },
): MedicationOrderInput {
  return {
    medicationDefinitionId: revision.medicationDefinitionId,
    doseAmount: override.doseAmount,
    doseUnit: revision.doseUnit as MedicationOrderInput['doseUnit'],
    route: override.route as MedicationOrderInput['route'],
    instructions: revision.instructions,
    indication: revision.indication,
    prescriberName: revision.prescriberName,
    sourceType: override.sourceType,
    sourceReference: override.sourceReference,
    prescribedAt: revision.prescribedAt?.toISOString() ?? null,
    validFrom: revision.validFrom,
    validUntil: revision.validUntil,
    schedule: scheduleInput(override.schedule),
  };
}

function scheduleInput(schedule: MedicationSchedule): MedicationOrderInput['schedule'] {
  if (schedule.type === 'fixed_times') return { type: schedule.type, times: schedule.times };
  if (schedule.type === 'interval')
    return {
      type: schedule.type,
      anchorAt: schedule.anchorAt,
      intervalMinutes: schedule.intervalMinutes,
    };
  return {
    type: schedule.type,
    indication: schedule.indication,
    ...(schedule.maximumDoseAmount !== undefined
      ? { maximumDoseAmount: schedule.maximumDoseAmount }
      : {}),
    ...(schedule.maximumAdministrations !== undefined
      ? { maximumAdministrations: schedule.maximumAdministrations }
      : {}),
    ...(schedule.frequencyWindowMinutes !== undefined
      ? { frequencyWindowMinutes: schedule.frequencyWindowMinutes }
      : {}),
    ...(schedule.minimumIntervalMinutes !== undefined
      ? { minimumIntervalMinutes: schedule.minimumIntervalMinutes }
      : {}),
  };
}

function reportedStatusToOrderStatus(
  status: ReportedMedicationStatus,
): MedicationOrderStatus | null {
  return status === 'unknown' ? null : status;
}

function nullableText(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  return value.trim();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function reconciliationError(code: string, status?: number): MedicationReconciliationError;
function reconciliationError(
  code: string,
  message?: string,
  status?: number,
): MedicationReconciliationError;
function reconciliationError(code: string, messageOrStatus: string | number = code, status = 400) {
  return new MedicationReconciliationError(
    code,
    typeof messageOrStatus === 'string' ? messageOrStatus : code,
    typeof messageOrStatus === 'number' ? messageOrStatus : status,
  );
}
