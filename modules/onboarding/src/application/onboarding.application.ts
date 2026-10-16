import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { AuditWriter } from '@care/audit';
import { benefitFundingSources, clientBenefitEntitlements } from '@care/benefits';
import {
  clientContactRoles,
  clientContacts,
  clientInsurances,
  clientRecords,
  pflegegradRecords,
} from '@care/clients';
import type { ClientApplicationService, CreateClientInput } from '@care/clients';
import { contactAuthorizationFor, interactions, prospectInteractions } from '@care/communications';
import type { CommunicationsApplicationService, CommunicationInput } from '@care/communications';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { documentArtifacts } from '@care/documents';
import { employeeRecords } from '@care/employees';
import { createDomainEvent } from '@care/events';
import { tenantMemberships, users } from '@care/identity';
import { tasks } from '@care/operations';
import { facilities, organizationsTable } from '@care/organizations';
import {
  AuthorizationDeniedError,
  assertCan,
  can,
  type AuthorizationPrincipal,
} from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { visits } from '@care/scheduling';
import { agreementServices, agreements } from '@care/service-agreements';
import type { ServicePriceApplicationService } from '@module/services/application/service-price.application';
import type { ServiceApplicationService } from '@module/services/application/service.application';
import { selectEffectiveServicePrice } from '@module/services/domain/service-price';

import {
  DEFAULT_CHECKLIST_ITEMS,
  canTransition,
  needsAssessmentComplete,
  needsAssessmentSchema,
  validateChecklistItems,
  InvalidAdmissionTransitionError,
  InvalidChecklistTemplateError,
  InvalidNeedsAssessmentError,
  type ChecklistItemInput,
} from '../domain/onboarding';
import {
  admissionAssessments,
  admissionCases,
  admissionCommunications,
  admissionDocuments,
  admissionTasks,
  admissionTransitions,
  checklistResponses,
  checklistTemplateItems,
  checklistTemplates,
  type AdmissionStage,
  type NeedsAssessment,
} from '../schema';

type AuditContext = { ip?: string; userAgent?: string };
type CaseResource = {
  tenantId: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
};

export type AdmissionCaseInput = {
  organizationId: string;
  facilityId?: string | null;
  ownerEmployeeId?: string | null;
  clientId?: string | null;
  firstName: string;
  lastName: string;
  contactMethod: 'phone' | 'email' | 'in_person' | 'letter' | 'other';
  requesterName?: string | null;
  requesterRelationship?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  requestedServices?: string[];
  preferredStartDate?: string | null;
  serviceLocation?: string | null;
  inquirySource: string;
  fundingPlan?: 'unknown' | 'private_pay' | 'benefits' | 'other';
  fundingPlanDetails?: string | null;
  initialNotes?: string | null;
  nextFollowUpAt?: Date | null;
};
export type AdmissionCaseChanges = Partial<
  Omit<AdmissionCaseInput, 'organizationId' | 'clientId'>
> & { expectedVersion: number };
export type AdmissionSearchQuery = {
  organizationId?: string;
  facilityId?: string;
  stage?: AdmissionStage;
  ownerEmployeeId?: string;
  createdFrom?: string;
  createdTo?: string;
  overdue?: boolean;
  readiness?: 'ready' | 'blocked';
  search?: string;
  sortBy?: 'createdAt' | 'lastActivityAt' | 'name' | 'nextFollowUpAt';
  sortDirection?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};
export type ReadinessFinding = {
  code: string;
  severity: 'blocker' | 'warning' | 'complete' | 'not_applicable';
  mandatory: boolean;
  category: string;
  label: string;
  detail?: string;
  detailCode?: string;
};
export type AdmissionReadiness = {
  caseId: string;
  caseVersion: number;
  stage: AdmissionStage;
  canAdmit: boolean;
  fundingBalance: 'unknown' | 'not_applicable';
  findings: ReadinessFinding[];
  blockers: ReadinessFinding[];
  warnings: ReadinessFinding[];
};
export type AdmissionOperationsCase = {
  id: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  stage: AdmissionStage;
  createdAt: Date;
  nextFollowUpAt: Date | null;
  preferredStartDate: string | null;
  blockerCount: number;
};
export type ProspectCommunicationInput = Omit<
  CommunicationInput,
  'contactId' | 'contactLabel' | 'source'
>;

export type AdmissionServicePricing = {
  requestedService: string;
  serviceId: string | null;
  serviceName: string | null;
  status: 'available' | 'price_missing' | 'service_unavailable' | 'ambiguous' | 'access_required';
  priceCents: number | null;
  pricingUnit: string | null;
};

export class OnboardingApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly clients: Pick<
      ClientApplicationService,
      'activateWithinTransaction' | 'createWithinTransaction'
    >,
    private readonly communications: Pick<
      CommunicationsApplicationService,
      'recordProspectInteractionWithinTransaction'
    >,
    private readonly services: Pick<ServiceApplicationService, 'search'>,
    private readonly prices: Pick<ServicePriceApplicationService, 'list'>,
  ) {}

  async search(principal: AuthorizationPrincipal, query: AdmissionSearchQuery = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new InvalidOnboardingQueryError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const filters = this.visibleCases(principal);
      if (query.organizationId)
        filters.push(eq(admissionCases.organizationId, query.organizationId));
      if (query.facilityId) filters.push(eq(admissionCases.facilityId, query.facilityId));
      if (query.stage) filters.push(eq(admissionCases.stage, query.stage));
      if (query.ownerEmployeeId)
        filters.push(eq(admissionCases.ownerEmployeeId, query.ownerEmployeeId));
      if (query.createdFrom)
        filters.push(gte(admissionCases.createdAt, new Date(`${query.createdFrom}T00:00:00.000Z`)));
      if (query.createdTo)
        filters.push(lte(admissionCases.createdAt, new Date(`${query.createdTo}T23:59:59.999Z`)));
      if (query.overdue) {
        filters.push(lte(admissionCases.nextFollowUpAt, new Date()));
        filters.push(
          inArray(admissionCases.stage, [
            'inquiry',
            'assessment',
            'preparation',
            'ready_for_admission',
          ]),
        );
      }
      if (query.readiness) {
        filters.push(
          inArray(admissionCases.stage, [
            'inquiry',
            'assessment',
            'preparation',
            'ready_for_admission',
          ]),
        );
      }
      const search = query.search?.trim().slice(0, 120);
      if (search) {
        const pattern = `%${escapeLike(search)}%`;
        filters.push(
          or(
            ilike(admissionCases.firstName, pattern),
            ilike(admissionCases.lastName, pattern),
            ilike(
              sql<string>`concat_ws(' ', ${admissionCases.firstName}, ${admissionCases.lastName})`,
              pattern,
            ),
            ilike(admissionCases.requesterName, pattern),
            ilike(admissionCases.contactEmail, pattern),
            ilike(admissionCases.contactPhone, pattern),
          )!,
        );
      }
      const where = and(...filters);
      const sortBy = query.sortBy ?? 'lastActivityAt';
      const sortDirection = query.sortDirection ?? 'desc';
      if (
        !['createdAt', 'lastActivityAt', 'name', 'nextFollowUpAt'].includes(sortBy) ||
        !['asc', 'desc'].includes(sortDirection)
      )
        throw new InvalidOnboardingQueryError();
      const orderBy = admissionSortOrder(sortBy, sortDirection);
      if (query.readiness) {
        const offset = (page - 1) * pageSize;
        const matchingItems: Array<{
          admission: typeof admissionCases.$inferSelect;
          readiness: AdmissionReadiness;
        }> = [];
        let total = 0;
        let scanned = 0;
        const batchSize = 100;
        // oxlint-disable no-await-in-loop
        while (true) {
          const candidates: Array<typeof admissionCases.$inferSelect> = await transaction
            .select()
            .from(admissionCases)
            .where(where)
            .orderBy(...orderBy)
            .limit(batchSize)
            .offset(scanned);
          if (!candidates.length) break;
          scanned += candidates.length;
          const readinessByCase = await this.evaluateReadinessBatch(
            transaction,
            principal,
            candidates,
          );
          for (const admission of candidates) {
            const readiness = readinessByCase.get(admission.id)!;
            if ((query.readiness === 'ready') !== readiness.canAdmit) continue;
            if (total >= offset && matchingItems.length < pageSize)
              matchingItems.push({ admission, readiness });
            total += 1;
          }
          if (candidates.length < batchSize) break;
        }
        // oxlint-enable no-await-in-loop
        const items = matchingItems.map(({ admission, readiness }) => ({
          ...redactCaseLinks(principal, admission),
          readinessSummary: readinessSummary(readiness),
        }));
        const namedItems = await this.addCaseReferenceNames(transaction, principal, items);
        return {
          items: namedItems,
          total,
          page,
          pageSize,
        };
      }
      const [totalRow] = await transaction
        .select({ value: count() })
        .from(admissionCases)
        .where(where);
      const total = totalRow?.value ?? 0;
      const items = await transaction
        .select()
        .from(admissionCases)
        .where(where)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const readinessByCase = await this.evaluateReadinessBatch(transaction, principal, items);
      const namedItems = await this.addCaseReferenceNames(
        transaction,
        principal,
        items.map((admission) => ({
          ...redactCaseLinks(principal, admission),
          readinessSummary: readinessSummary(readinessByCase.get(admission.id)!),
        })),
      );
      return {
        items: namedItems,
        total,
        page,
        pageSize,
      };
    });
  }

  private async addCaseReferenceNames<
    T extends {
      id: string;
      tenantId: string;
      organizationId: string;
      facilityId: string | null;
      ownerEmployeeId: string | null;
      clientId: string | null;
    },
  >(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    rows: T[],
  ): Promise<
    Array<
      T & {
        organizationName: string | null;
        facilityName: string | null;
        ownerEmployeeName: string | null;
        clientName: string | null;
      }
    >
  > {
    if (!rows.length) return [];
    const readable = <K extends 'organization' | 'facility' | 'employee' | 'client'>(
      action: `${K}.read`,
      idOf: (row: T) => string | null,
    ) =>
      new Set(
        rows
          .filter((row) => {
            const id = idOf(row);
            if (!id) return false;
            const resource = caseResource(row);
            return can(principal, { action, resource });
          })
          .map((row) => idOf(row)!)
          .filter(Boolean),
      );
    const organizationIds = readable('organization.read', (row) => row.organizationId);
    const facilityIds = readable('facility.read', (row) => row.facilityId);
    const employeeIds = readable('employee.read', (row) => row.ownerEmployeeId);
    const clientIds = readable('client.read', (row) => row.clientId);
    const [organizationRows, facilityRows, employeeRows, clientRows] = await Promise.all([
      organizationIds.size
        ? transaction
            .select({ id: organizationsTable.id, name: organizationsTable.name })
            .from(organizationsTable)
            .where(
              and(
                eq(organizationsTable.tenantId, principal.tenantId),
                inArray(organizationsTable.id, [...organizationIds]),
              ),
            )
        : [],
      facilityIds.size
        ? transaction
            .select({ id: facilities.id, name: facilities.name })
            .from(facilities)
            .where(
              and(
                eq(facilities.tenantId, principal.tenantId),
                inArray(facilities.id, [...facilityIds]),
              ),
            )
        : [],
      employeeIds.size
        ? transaction
            .select({
              id: employeeRecords.id,
              firstName: employeeRecords.firstName,
              preferredName: employeeRecords.preferredName,
              lastName: employeeRecords.lastName,
            })
            .from(employeeRecords)
            .where(
              and(
                eq(employeeRecords.tenantId, principal.tenantId),
                inArray(employeeRecords.id, [...employeeIds]),
              ),
            )
        : [],
      clientIds.size
        ? transaction
            .select({
              id: clientRecords.id,
              firstName: clientRecords.firstName,
              preferredName: clientRecords.preferredName,
              lastName: clientRecords.lastName,
            })
            .from(clientRecords)
            .where(
              and(
                eq(clientRecords.tenantId, principal.tenantId),
                inArray(clientRecords.id, [...clientIds]),
              ),
            )
        : [],
    ]);
    const organizationNames = new Map(organizationRows.map((row) => [row.id, row.name]));
    const facilityNames = new Map(facilityRows.map((row) => [row.id, row.name]));
    const employeeNames = new Map(
      employeeRows.map((row) => [row.id, `${row.preferredName || row.firstName} ${row.lastName}`]),
    );
    const clientNames = new Map(
      clientRows.map((row) => [row.id, `${row.preferredName || row.firstName} ${row.lastName}`]),
    );
    return rows.map((row) => ({
      ...row,
      organizationName: organizationNames.get(row.organizationId) ?? null,
      facilityName: row.facilityId ? (facilityNames.get(row.facilityId) ?? null) : null,
      ownerEmployeeName: row.ownerEmployeeId
        ? (employeeNames.get(row.ownerEmployeeId) ?? null)
        : null,
      clientName: row.clientId ? (clientNames.get(row.clientId) ?? null) : null,
    }));
  }

  async create(
    principal: AuthorizationPrincipal,
    input: AdmissionCaseInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    validateCaseInput(input);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const resource = {
        tenantId: principal.tenantId,
        organizationId: input.organizationId,
        ...(input.facilityId ? { facilityId: input.facilityId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
      };
      assertCan(principal, { action: 'onboarding.create', resource });
      await this.validateProvider(
        transaction,
        principal.tenantId,
        input.organizationId,
        input.facilityId ?? null,
      );
      if (input.ownerEmployeeId)
        await this.validateOwner(
          transaction,
          principal,
          input.organizationId,
          input.ownerEmployeeId,
        );
      if (input.clientId)
        await this.validateClientLink(
          transaction,
          principal,
          input.clientId,
          resource,
          input.firstName,
          input.lastName,
        );
      const template = await this.ensureDefaultTemplate(
        transaction,
        principal,
        input.organizationId,
      );
      const id = uuidv7();
      const row = {
        id,
        tenantId: principal.tenantId,
        organizationId: input.organizationId,
        facilityId: input.facilityId ?? null,
        clientId: input.clientId ?? null,
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        checklistTemplateId: template.id,
        checklistTemplateVersion: template.currentVersion,
        firstVisitId: null,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        contactMethod: input.contactMethod,
        requesterName: trimOrNull(input.requesterName),
        requesterRelationship: trimOrNull(input.requesterRelationship),
        contactEmail: trimOrNull(input.contactEmail),
        contactPhone: trimOrNull(input.contactPhone),
        requestedServices: input.requestedServices ?? [],
        preferredStartDate: input.preferredStartDate ?? null,
        serviceLocation: trimOrNull(input.serviceLocation),
        inquirySource: input.inquirySource.trim(),
        fundingPlan: input.fundingPlan ?? 'unknown',
        fundingPlanDetails: trimOrNull(input.fundingPlanDetails),
        initialNotes: trimOrNull(input.initialNotes),
        stage: 'inquiry' as const,
        version: 1,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        lastActivityAt: now,
        admittedAt: null,
        admittedByUserId: null,
        decisionSnapshot: null,
        createdByUserId: principal.userId,
        createdAt: now,
        updatedAt: now,
      };
      await transaction.insert(admissionCases).values(row);
      await transaction.insert(admissionTransitions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        caseId: id,
        fromStage: null,
        toStage: 'inquiry',
        version: 1,
        reason: null,
        actorUserId: principal.userId,
        readinessSnapshot: null,
        occurredAt: now,
      });
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.case_created',
        resourceType: 'onboarding_case',
        metadata: { organizationId: input.organizationId, stage: 'inquiry' },
        event: createDomainEvent({
          type: 'onboarding.case_created',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, version: 1 },
        }),
      });
      return row;
    });
  }

  async summary(principal: AuthorizationPrincipal, id: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(transaction, principal, id, 'onboarding.read');
      const [namedAdmission] = await this.addCaseReferenceNames(transaction, principal, [
        redactCaseLinks(principal, admission),
      ]);
      return namedAdmission;
    });
  }

  async get(principal: AuthorizationPrincipal, id: string) {
    const detail = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const admission = await this.requireCase(transaction, principal, id, 'onboarding.read');
        const [assessment] = await transaction
          .select()
          .from(admissionAssessments)
          .where(
            and(
              eq(admissionAssessments.tenantId, principal.tenantId),
              eq(admissionAssessments.caseId, id),
            ),
          )
          .limit(1);
        const items =
          admission.checklistTemplateId && admission.checklistTemplateVersion
            ? await transaction
                .select()
                .from(checklistTemplateItems)
                .where(
                  and(
                    eq(checklistTemplateItems.tenantId, principal.tenantId),
                    eq(checklistTemplateItems.templateId, admission.checklistTemplateId),
                    eq(checklistTemplateItems.templateVersion, admission.checklistTemplateVersion),
                  ),
                )
                .orderBy(asc(checklistTemplateItems.sortOrder), asc(checklistTemplateItems.code))
            : [];
        const responses = await transaction
          .select()
          .from(checklistResponses)
          .where(
            and(
              eq(checklistResponses.tenantId, principal.tenantId),
              eq(checklistResponses.caseId, id),
            ),
          );
        const readiness = await this.evaluateReadiness(transaction, principal, admission);
        const history = await transaction
          .select()
          .from(admissionTransitions)
          .where(
            and(
              eq(admissionTransitions.tenantId, principal.tenantId),
              eq(admissionTransitions.caseId, id),
            ),
          )
          .orderBy(asc(admissionTransitions.version));
        const actorIds = [...new Set(history.map((entry) => entry.actorUserId))];
        const actorRows = actorIds.length
          ? await transaction
              .select({ id: users.id, displayName: users.displayName })
              .from(tenantMemberships)
              .innerJoin(users, eq(users.id, tenantMemberships.userId))
              .where(
                and(
                  eq(tenantMemberships.tenantId, principal.tenantId),
                  inArray(users.id, actorIds),
                ),
              )
          : [];
        const actorNames = new Map(
          actorRows.flatMap((actor) =>
            actor.displayName ? [[actor.id, actor.displayName] as const] : [],
          ),
        );
        const clientReadable = Boolean(
          admission.clientId &&
          can(principal, { action: 'client.read', resource: clientResource(admission) }),
        );
        const documentAccess =
          clientReadable &&
          can(principal, { action: 'documents.read', resource: clientResource(admission) });
        const documents = documentAccess
          ? await transaction
              .select({ link: admissionDocuments, artifact: documentArtifacts })
              .from(admissionDocuments)
              .innerJoin(
                documentArtifacts,
                and(
                  eq(documentArtifacts.tenantId, admissionDocuments.tenantId),
                  eq(documentArtifacts.id, admissionDocuments.documentArtifactId),
                ),
              )
              .where(
                and(
                  eq(admissionDocuments.tenantId, principal.tenantId),
                  eq(admissionDocuments.caseId, id),
                  eq(documentArtifacts.clientId, admission.clientId!),
                  eq(documentArtifacts.organizationId, admission.organizationId),
                ),
              )
          : [];
        const linkedTaskRows = await transaction
          .select({ link: admissionTasks, task: tasks })
          .from(admissionTasks)
          .innerJoin(
            tasks,
            and(eq(tasks.tenantId, admissionTasks.tenantId), eq(tasks.id, admissionTasks.taskId)),
          )
          .where(
            and(eq(admissionTasks.tenantId, principal.tenantId), eq(admissionTasks.caseId, id)),
          );
        const linkedTasks = linkedTaskRows.filter(({ task }) => {
          if (
            task.organizationId !== admission.organizationId ||
            (admission.clientId && task.clientId && task.clientId !== admission.clientId)
          )
            return false;
          const resource = {
            tenantId: task.tenantId,
            organizationId: task.organizationId,
            ...(task.facilityId ? { facilityId: task.facilityId } : {}),
            ...(task.clientId ? { clientId: task.clientId } : {}),
          };
          return (
            can(principal, { action: 'operations.read', resource }) &&
            (!task.clientId || can(principal, { action: 'client.read', resource }))
          );
        });
        const communicationReadable =
          can(principal, { action: 'communications.read', resource: caseResource(admission) }) &&
          (!admission.clientId || clientReadable);
        const linkedCommunications =
          admission.clientId && communicationReadable
            ? await transaction
                .select({ link: admissionCommunications, interaction: interactions })
                .from(admissionCommunications)
                .innerJoin(
                  interactions,
                  and(
                    eq(interactions.tenantId, admissionCommunications.tenantId),
                    eq(interactions.id, admissionCommunications.interactionId),
                  ),
                )
                .where(
                  and(
                    eq(admissionCommunications.tenantId, principal.tenantId),
                    eq(admissionCommunications.caseId, id),
                    eq(interactions.clientId, admission.clientId),
                  ),
                )
                .orderBy(desc(interactions.occurredAt), desc(interactions.id))
            : [];
        const intakeCommunications = communicationReadable
          ? await transaction
              .select()
              .from(prospectInteractions)
              .where(
                and(
                  eq(prospectInteractions.tenantId, principal.tenantId),
                  eq(prospectInteractions.caseId, id),
                ),
              )
              .orderBy(desc(prospectInteractions.occurredAt), desc(prospectInteractions.id))
          : [];
        const communications = [
          ...linkedCommunications.map((entry) => ({ ...entry, prospect: false })),
          ...intakeCommunications.map((interaction) => ({
            link: { interactionId: interaction.id },
            interaction,
            prospect: true,
          })),
        ].sort(
          (left, right) =>
            right.interaction.occurredAt.getTime() - left.interaction.occurredAt.getTime(),
        );
        const [namedAdmission] = await this.addCaseReferenceNames(transaction, principal, [
          redactCaseLinks(principal, admission),
        ]);
        const canReadFirstVisit =
          clientReadable &&
          Boolean(admission.firstVisitId) &&
          can(principal, { action: 'schedule.read', resource: clientResource(admission) });
        const firstVisitRows = canReadFirstVisit
          ? await transaction
              .select({
                id: visits.id,
                clientId: visits.clientId,
                plannedStart: visits.plannedStart,
              })
              .from(visits)
              .where(
                and(
                  eq(visits.tenantId, principal.tenantId),
                  eq(visits.id, admission.firstVisitId!),
                  eq(visits.clientId, admission.clientId!),
                ),
              )
          : [];
        return {
          ...namedAdmission!,
          firstVisitStartsAt: firstVisitRows[0]?.plannedStart ?? null,
          assessment: assessment?.data ?? null,
          assessmentUpdatedAt: assessment?.updatedAt ?? null,
          checklist: items.map((item) => ({
            ...item,
            response: responses.find((response) => response.itemCode === item.code) ?? null,
            finding: readiness.findings.find((finding) => finding.code === item.code) ?? null,
          })),
          readiness,
          history: history.map((entry) => ({
            ...(clientReadable ? entry : { ...entry, readinessSnapshot: null }),
            actorName: actorNames.get(entry.actorUserId) ?? null,
          })),
          documents,
          tasks: linkedTasks,
          communications,
        };
      },
    );
    const servicePricing = await this.servicePricing(principal, detail, detail.assessment);
    return { ...detail, servicePricing };
  }

  private async servicePricing(
    principal: AuthorizationPrincipal,
    admission: typeof admissionCases.$inferSelect,
    assessment: NeedsAssessment | null,
  ): Promise<AdmissionServicePricing[]> {
    const requestedServices = [
      ...new Map(
        (assessment?.requestedServices ?? admission.requestedServices).map((value) => [
          normalizeName(value),
          value,
        ]),
      ).values(),
    ];
    if (!requestedServices.length) return [];
    if (
      !can(principal, {
        action: 'service.read',
        resource: caseResource(admission),
      })
    ) {
      return requestedServices.map((requestedService) => ({
        requestedService,
        serviceId: null,
        serviceName: null,
        status: 'access_required',
        priceCents: null,
        pricingUnit: null,
      }));
    }

    const validAt =
      assessment?.preferredStartDate ??
      admission.preferredStartDate ??
      new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      requestedServices.map(async (requestedService): Promise<AdmissionServicePricing> => {
        const search = await this.services.search(principal, {
          text: requestedService,
          status: 'active',
          organizationId: admission.organizationId,
          ...(admission.facilityId ? { facilityId: admission.facilityId } : {}),
          validAt,
          page: 1,
          pageSize: 100,
        });
        const normalized = normalizeName(requestedService);
        const exact = search.items.filter(({ service }) =>
          [service.code, service.name].some((value) => normalizeName(value) === normalized),
        );
        if (exact.length > 1)
          return {
            requestedService,
            serviceId: null,
            serviceName: null,
            status: 'ambiguous',
            priceCents: null,
            pricingUnit: null,
          };
        const match = exact[0];
        if (!match)
          return {
            requestedService,
            serviceId: null,
            serviceName: null,
            status: 'service_unavailable',
            priceCents: null,
            pricingUnit: null,
          };
        const effective = selectEffectiveServicePrice(
          await this.prices.list(principal, match.service.id, {
            organizationId: admission.organizationId,
            facilityId: admission.facilityId,
            validAt,
          }),
          { facilityId: admission.facilityId },
        );
        return {
          requestedService,
          serviceId: match.service.id,
          serviceName: match.service.name,
          status: effective ? 'available' : 'price_missing',
          priceCents: effective?.priceCents ?? null,
          pricingUnit: effective?.pricingUnit ?? null,
        };
      }),
    );
    return results;
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    changes: AdmissionCaseChanges,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    validateCaseChanges(changes);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.checkVersion(admission.version, changes.expectedVersion);
      this.assertEditable(admission);
      if (changes.facilityId !== undefined)
        await this.validateProvider(
          transaction,
          principal.tenantId,
          admission.organizationId,
          changes.facilityId ?? null,
        );
      if (changes.facilityId && admission.clientId) {
        const client = await this.getClient(transaction, principal.tenantId, admission.clientId);
        if (
          !client ||
          client.organizationId !== admission.organizationId ||
          client.primaryFacilityId !== changes.facilityId
        ) {
          throw new OnboardingClientLinkInvalidError();
        }
        assertCan(principal, { action: 'client.read', resource: clientResource(client) });
      }
      if (changes.ownerEmployeeId)
        await this.validateOwner(
          transaction,
          principal,
          admission.organizationId,
          changes.ownerEmployeeId,
        );
      const changedFields = Object.keys(changes).filter((field) => field !== 'expectedVersion');
      if (changedFields.length === 0) return redactCaseLinks(principal, admission);
      const patch: Partial<typeof admissionCases.$inferInsert> = {
        version: admission.version + 1,
        lastActivityAt: now,
        updatedAt: now,
      };
      if (changes.facilityId !== undefined) patch.facilityId = changes.facilityId ?? null;
      if (changes.ownerEmployeeId !== undefined)
        patch.ownerEmployeeId = changes.ownerEmployeeId ?? null;
      if (changes.firstName !== undefined) patch.firstName = changes.firstName.trim();
      if (changes.lastName !== undefined) patch.lastName = changes.lastName.trim();
      if (changes.contactMethod !== undefined) patch.contactMethod = changes.contactMethod;
      if (changes.requesterName !== undefined)
        patch.requesterName = trimOrNull(changes.requesterName);
      if (changes.requesterRelationship !== undefined)
        patch.requesterRelationship = trimOrNull(changes.requesterRelationship);
      if (changes.contactEmail !== undefined) patch.contactEmail = trimOrNull(changes.contactEmail);
      if (changes.contactPhone !== undefined) patch.contactPhone = trimOrNull(changes.contactPhone);
      if (changes.requestedServices !== undefined)
        patch.requestedServices = changes.requestedServices;
      if (changes.preferredStartDate !== undefined)
        patch.preferredStartDate = changes.preferredStartDate ?? null;
      if (changes.serviceLocation !== undefined)
        patch.serviceLocation = trimOrNull(changes.serviceLocation);
      if (changes.inquirySource !== undefined) patch.inquirySource = changes.inquirySource.trim();
      if (changes.fundingPlan !== undefined) patch.fundingPlan = changes.fundingPlan;
      if (changes.fundingPlanDetails !== undefined)
        patch.fundingPlanDetails = trimOrNull(changes.fundingPlanDetails);
      if (changes.initialNotes !== undefined) patch.initialNotes = trimOrNull(changes.initialNotes);
      if (changes.nextFollowUpAt !== undefined)
        patch.nextFollowUpAt = changes.nextFollowUpAt ?? null;
      const [updated] = await transaction
        .update(admissionCases)
        .set(patch)
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, changes.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.case_updated',
        resourceType: 'onboarding_case',
        metadata: { changedFields },
        event: createDomainEvent({
          type: 'onboarding.case_updated',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, changedFields, version: updated.version },
        }),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async linkClient(
    principal: AuthorizationPrincipal,
    id: string,
    input: { clientId: string; expectedVersion: number; reason?: string },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertEditable(admission);
      if (admission.clientId)
        assertCan(principal, { action: 'client.read', resource: clientResource(admission) });
      if (admission.clientId === input.clientId) return redactCaseLinks(principal, admission);
      this.checkVersion(admission.version, input.expectedVersion);
      await this.validateClientLink(
        transaction,
        principal,
        input.clientId,
        caseResource(admission),
        admission.firstName,
        admission.lastName,
        input.reason,
      );
      const [updated] = await transaction
        .update(admissionCases)
        .set({
          clientId: input.clientId,
          version: admission.version + 1,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.client_linked',
        resourceType: 'onboarding_case',
        metadata: { clientId: input.clientId, reasonRecorded: Boolean(input.reason?.trim()) },
        event: createDomainEvent({
          type: 'onboarding.case_updated',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, changedFields: ['clientId'], version: updated.version },
        }),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async registerClient(
    principal: AuthorizationPrincipal,
    id: string,
    expectedVersion: number,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      if (admission.clientId) return redactCaseLinks(principal, admission);
      this.checkVersion(admission.version, expectedVersion);
      this.assertEditable(admission);
      if (!admission.facilityId) throw new OnboardingFacilityRequiredError();
      const client = await this.clients.createWithinTransaction(
        transaction,
        principal,
        {
          organizationId: admission.organizationId,
          primaryFacilityId: admission.facilityId,
          firstName: admission.firstName,
          lastName: admission.lastName,
        } satisfies CreateClientInput,
        context,
        auditContext,
      );
      const now = new Date();
      const [updated] = await transaction
        .update(admissionCases)
        .set({
          clientId: client.id,
          version: admission.version + 1,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.client_registered',
        resourceType: 'onboarding_case',
        metadata: { clientId: client.id },
        event: caseUpdatedEvent(principal, context, id, ['clientId'], updated.version),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async saveAssessment(
    principal: AuthorizationPrincipal,
    id: string,
    input: { expectedVersion: number; data: NeedsAssessment },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const parsed = needsAssessmentSchema.safeParse(input.data);
    if (!parsed.success) throw new InvalidNeedsAssessmentError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.checkVersion(admission.version, input.expectedVersion);
      this.assertEditable(admission);
      const [current] = await transaction
        .select({ version: admissionAssessments.version })
        .from(admissionAssessments)
        .where(
          and(
            eq(admissionAssessments.tenantId, principal.tenantId),
            eq(admissionAssessments.caseId, id),
          ),
        )
        .limit(1);
      const assessmentVersion = (current?.version ?? 0) + 1;
      await transaction
        .insert(admissionAssessments)
        .values({
          tenantId: principal.tenantId,
          caseId: id,
          version: assessmentVersion,
          data: parsed.data,
          updatedByUserId: principal.userId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [admissionAssessments.tenantId, admissionAssessments.caseId],
          set: {
            version: assessmentVersion,
            data: parsed.data,
            updatedByUserId: principal.userId,
            updatedAt: now,
          },
        });
      const [updated] = await transaction
        .update(admissionCases)
        .set({ version: admission.version + 1, lastActivityAt: now, updatedAt: now })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.assessment_updated',
        resourceType: 'onboarding_case',
        metadata: { assessmentVersion },
        event: createDomainEvent({
          type: 'onboarding.assessment_updated',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, version: updated.version },
        }),
      });
      return { case: redactCaseLinks(principal, updated), assessment: parsed.data };
    });
  }

  async readiness(principal: AuthorizationPrincipal, id: string): Promise<AdmissionReadiness> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(transaction, principal, id, 'onboarding.read');
      return this.evaluateReadiness(transaction, principal, admission);
    });
  }

  async operationsReadinessWorklist(
    principal: AuthorizationPrincipal,
    deadlineWindow: {
      fromDate: string;
      untilDate: string;
      organizationId?: string;
      facilityId?: string;
      clientId?: string;
    },
    onPage?: (items: AdmissionOperationsCase[]) => Promise<void>,
  ): Promise<{ items: AdmissionOperationsCase[]; complete: boolean }> {
    const filters = this.visibleCases(principal);
    if (deadlineWindow.organizationId)
      filters.push(eq(admissionCases.organizationId, deadlineWindow.organizationId));
    if (deadlineWindow.facilityId)
      filters.push(eq(admissionCases.facilityId, deadlineWindow.facilityId));
    if (deadlineWindow.clientId) filters.push(eq(admissionCases.clientId, deadlineWindow.clientId));
    filters.push(
      inArray(admissionCases.stage, [
        'inquiry',
        'assessment',
        'preparation',
        'ready_for_admission',
      ]),
    );
    const batchSize = 100;
    const now = new Date();
    const until = new Date(`${deadlineWindow.untilDate}T23:59:59.999Z`);
    const items: AdmissionOperationsCase[] = [];
    let cursor: typeof admissionCases.$inferSelect | null = null;
    // oxlint-disable no-await-in-loop
    while (true) {
      const batchFilters: typeof filters = cursor
        ? [
            ...filters,
            or(
              lt(admissionCases.lastActivityAt, cursor.lastActivityAt),
              and(
                eq(admissionCases.lastActivityAt, cursor.lastActivityAt),
                lt(admissionCases.id, cursor.id),
              ),
            )!,
          ]
        : filters;
      const batch = await this.unitOfWork.transaction(
        { tenantId: principal.tenantId },
        async (transaction) => {
          const candidates: Array<typeof admissionCases.$inferSelect> = await transaction
            .select()
            .from(admissionCases)
            .where(and(...batchFilters))
            .orderBy(desc(admissionCases.lastActivityAt), desc(admissionCases.id))
            .limit(batchSize);
          if (!candidates.length) return { candidates, items: [] as AdmissionOperationsCase[] };
          const readinessByCase = await this.evaluateReadinessBatch(
            transaction,
            principal,
            candidates,
          );
          const candidateIds = candidates.map(({ id }) => id);
          const assessmentRows = await transaction
            .select({ caseId: admissionAssessments.caseId, data: admissionAssessments.data })
            .from(admissionAssessments)
            .where(
              and(
                eq(admissionAssessments.tenantId, principal.tenantId),
                inArray(admissionAssessments.caseId, candidateIds),
              ),
            );
          const preferredStartDateByCase = new Map(
            assessmentRows.map((row) => [row.caseId, row.data.preferredStartDate]),
          );
          const page = candidates.flatMap((admission) => {
            const blockerCount = readinessByCase.get(admission.id)!.blockers.length;
            const overdue = Boolean(admission.nextFollowUpAt && admission.nextFollowUpAt < now);
            const upcomingFollowUp = Boolean(
              admission.nextFollowUpAt &&
              admission.nextFollowUpAt > now &&
              admission.nextFollowUpAt <= until,
            );
            const requestedStartDate =
              preferredStartDateByCase.get(admission.id) ?? admission.preferredStartDate;
            const startDateInWindow = Boolean(
              requestedStartDate &&
              isISODate(requestedStartDate) &&
              requestedStartDate >= deadlineWindow.fromDate &&
              requestedStartDate <= deadlineWindow.untilDate,
            );
            if (!blockerCount && !overdue && !upcomingFollowUp && !startDateInWindow) return [];
            return [
              {
                id: admission.id,
                firstName: admission.firstName,
                lastName: admission.lastName,
                organizationId: admission.organizationId,
                facilityId: admission.facilityId,
                clientId:
                  admission.clientId &&
                  can(principal, { action: 'client.read', resource: clientResource(admission) })
                    ? admission.clientId
                    : null,
                stage: admission.stage,
                createdAt: admission.createdAt,
                nextFollowUpAt: admission.nextFollowUpAt,
                preferredStartDate:
                  requestedStartDate && isISODate(requestedStartDate) ? requestedStartDate : null,
                blockerCount,
              },
            ];
          });
          return { candidates, items: page };
        },
      );
      if (!batch.candidates.length) break;
      if (onPage) await onPage(batch.items);
      else items.push(...batch.items);
      cursor = batch.candidates[batch.candidates.length - 1]!;
      if (batch.candidates.length < batchSize) break;
    }
    // oxlint-enable no-await-in-loop
    return { items, complete: true };
  }

  async operationsIssueState(principal: AuthorizationPrincipal, id: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(transaction, principal, id, 'onboarding.read');
      const readiness = await this.evaluateReadiness(transaction, principal, admission);
      const active = !['admitted', 'declined', 'withdrawn'].includes(admission.stage);
      const [assessment] = await transaction
        .select({ data: admissionAssessments.data })
        .from(admissionAssessments)
        .where(
          and(
            eq(admissionAssessments.tenantId, principal.tenantId),
            eq(admissionAssessments.caseId, admission.id),
          ),
        )
        .limit(1);
      const preferredStartDate =
        assessment?.data.preferredStartDate ?? admission.preferredStartDate;
      const now = new Date();
      const overdue = Boolean(active && admission.nextFollowUpAt && admission.nextFollowUpAt < now);
      return {
        readinessBlocked: active && readiness.blockers.length > 0,
        followUpOverdue: overdue,
        followUpDue: Boolean(active && admission.nextFollowUpAt && admission.nextFollowUpAt >= now),
        startDateActionable: Boolean(active && preferredStartDate && isISODate(preferredStartDate)),
      };
    });
  }

  async transition(
    principal: AuthorizationPrincipal,
    id: string,
    input: { expectedVersion: number; toStage: AdmissionStage; reason?: string },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (input.toStage === 'admitted')
      throw new InvalidAdmissionTransitionError('ready_for_admission', 'admitted');
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.checkVersion(admission.version, input.expectedVersion);
      if (!canTransition(admission.stage, input.toStage))
        throw new InvalidAdmissionTransitionError(admission.stage, input.toStage);
      if (
        (input.toStage === 'declined' ||
          input.toStage === 'withdrawn' ||
          admission.stage === 'declined' ||
          admission.stage === 'withdrawn') &&
        !input.reason?.trim()
      ) {
        throw new OnboardingDecisionReasonRequiredError();
      }
      const readiness =
        input.toStage === 'ready_for_admission'
          ? await this.evaluateReadiness(transaction, principal, admission)
          : null;
      if (readiness && !readiness.canAdmit)
        throw new OnboardingReadinessBlockedError(readiness.blockers);
      const version = admission.version + 1;
      const [updated] = await transaction
        .update(admissionCases)
        .set({ stage: input.toStage, version, lastActivityAt: now, updatedAt: now })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await transaction.insert(admissionTransitions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        caseId: id,
        fromStage: admission.stage,
        toStage: input.toStage,
        version,
        reason: input.reason?.trim() || null,
        actorUserId: principal.userId,
        readinessSnapshot: readiness,
        occurredAt: now,
      });
      const action =
        input.toStage === 'declined'
          ? 'onboarding.declined'
          : input.toStage === 'withdrawn'
            ? 'onboarding.withdrawn'
            : 'onboarding.stage_changed';
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action,
        resourceType: 'onboarding_case',
        metadata: { fromStage: admission.stage, toStage: input.toStage, version },
        event: stageEvent(principal, context, id, admission.stage, input.toStage, version),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async admit(
    principal: AuthorizationPrincipal,
    id: string,
    expectedVersion: number,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.admit',
        true,
      );
      if (admission.stage === 'admitted') return redactCaseLinks(principal, admission);
      this.checkVersion(admission.version, expectedVersion);
      if (admission.stage !== 'ready_for_admission')
        throw new OnboardingNotReadyForAdmissionError();
      const readiness = await this.evaluateReadiness(transaction, principal, admission);
      if (!readiness.canAdmit) throw new OnboardingReadinessBlockedError(readiness.blockers);
      if (!admission.clientId) throw new OnboardingClientLinkRequiredError();
      const [client] = await transaction
        .select()
        .from(clientRecords)
        .where(
          and(
            eq(clientRecords.tenantId, principal.tenantId),
            eq(clientRecords.id, admission.clientId),
          ),
        )
        .limit(1);
      if (!client) throw new OnboardingClientLinkInvalidError();
      if (client.status === 'pending')
        await this.clients.activateWithinTransaction(
          transaction,
          principal,
          client.id,
          context,
          auditContext,
        );
      else if (client.status !== 'active') throw new OnboardingClientLinkInvalidError();
      const version = admission.version + 1;
      const snapshot = {
        ...readiness,
        decidedAt: now.toISOString(),
        clientId: client.id,
        checklistTemplateId: admission.checklistTemplateId,
        checklistTemplateVersion: admission.checklistTemplateVersion,
      };
      const [updated] = await transaction
        .update(admissionCases)
        .set({
          stage: 'admitted',
          version,
          admittedAt: now,
          admittedByUserId: principal.userId,
          decisionSnapshot: snapshot,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await transaction.insert(admissionTransitions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        caseId: id,
        fromStage: 'ready_for_admission',
        toStage: 'admitted',
        version,
        reason: null,
        actorUserId: principal.userId,
        readinessSnapshot: snapshot,
        occurredAt: now,
      });
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.admitted',
        resourceType: 'onboarding_case',
        metadata: { clientId: client.id, version },
        event: createDomainEvent({
          type: 'onboarding.admitted',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, clientId: client.id, version },
        }),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async respondChecklist(
    principal: AuthorizationPrincipal,
    id: string,
    input: {
      expectedVersion: number;
      itemCode: string;
      status: 'complete' | 'not_applicable';
      reason?: string;
    },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.checkVersion(admission.version, input.expectedVersion);
      this.assertEditable(admission);
      if (!admission.checklistTemplateId || !admission.checklistTemplateVersion)
        throw new OnboardingChecklistItemNotFoundError();
      const [item] = await transaction
        .select()
        .from(checklistTemplateItems)
        .where(
          and(
            eq(checklistTemplateItems.tenantId, principal.tenantId),
            eq(checklistTemplateItems.templateId, admission.checklistTemplateId),
            eq(checklistTemplateItems.templateVersion, admission.checklistTemplateVersion),
            eq(checklistTemplateItems.code, input.itemCode),
          ),
        )
        .limit(1);
      if (!item || item.source !== 'manual') throw new OnboardingChecklistItemNotFoundError();
      if (input.status === 'not_applicable' && !input.reason?.trim())
        throw new OnboardingDecisionReasonRequiredError();
      if (input.status === 'complete' && input.reason?.trim())
        throw new InvalidChecklistResponseError();
      await transaction
        .insert(checklistResponses)
        .values({
          tenantId: principal.tenantId,
          caseId: id,
          templateVersion: admission.checklistTemplateVersion,
          itemCode: input.itemCode,
          status: input.status,
          reason: input.status === 'not_applicable' ? input.reason!.trim() : null,
          updatedByUserId: principal.userId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            checklistResponses.tenantId,
            checklistResponses.caseId,
            checklistResponses.itemCode,
          ],
          set: {
            templateVersion: admission.checklistTemplateVersion,
            status: input.status,
            reason: input.status === 'not_applicable' ? input.reason!.trim() : null,
            updatedByUserId: principal.userId,
            updatedAt: now,
          },
        });
      const updated = await this.touchCase(transaction, admission, now);
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.checklist_updated',
        resourceType: 'onboarding_case',
        metadata: { itemCode: input.itemCode, status: input.status },
        event: createDomainEvent({
          type: 'onboarding.checklist_updated',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { caseId: id, itemCode: input.itemCode, version: updated.version },
        }),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async linkDocument(
    principal: AuthorizationPrincipal,
    id: string,
    input: { documentArtifactId: string; requirementCode: string },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertEditable(admission);
      if (!admission.clientId) throw new OnboardingClientLinkRequiredError();
      assertCan(principal, { action: 'client.read', resource: clientResource(admission) });
      assertCan(principal, { action: 'documents.read', resource: clientResource(admission) });
      const item = await this.requireChecklistItem(
        transaction,
        principal.tenantId,
        admission,
        input.requirementCode,
        'document',
      );
      const [artifact] = await transaction
        .select()
        .from(documentArtifacts)
        .where(
          and(
            eq(documentArtifacts.tenantId, principal.tenantId),
            eq(documentArtifacts.id, input.documentArtifactId),
          ),
        )
        .limit(1);
      if (
        !artifact ||
        artifact.clientId !== admission.clientId ||
        artifact.organizationId !== admission.organizationId
      )
        throw new OnboardingDocumentNotFoundError();
      await transaction
        .insert(admissionDocuments)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          caseId: id,
          documentArtifactId: artifact.id,
          requirementCode: item.code,
          linkedByUserId: principal.userId,
          linkedAt: now,
        })
        .onConflictDoNothing();
      const updated = await this.touchCase(transaction, admission, now);
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.document_linked',
        resourceType: 'onboarding_case',
        metadata: { requirementCode: item.code, documentArtifactId: artifact.id },
        event: caseUpdatedEvent(principal, context, id, ['documents'], updated.version),
      });
      return { id: artifact.id, status: artifact.status, requirementCode: item.code };
    });
  }

  async linkTask(
    principal: AuthorizationPrincipal,
    id: string,
    taskId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertOperationalFollowUpAllowed(admission);
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(and(eq(tasks.tenantId, principal.tenantId), eq(tasks.id, taskId)))
        .limit(1);
      if (!task) throw new OnboardingTaskNotFoundError();
      assertCan(principal, {
        action: 'operations.read',
        resource: {
          tenantId: task.tenantId,
          organizationId: task.organizationId,
          ...(task.facilityId ? { facilityId: task.facilityId } : {}),
          ...(task.clientId ? { clientId: task.clientId } : {}),
        },
      });
      if (task.clientId) {
        assertCan(principal, {
          action: 'client.read',
          resource: {
            tenantId: task.tenantId,
            clientId: task.clientId,
            organizationId: task.organizationId,
            ...(task.facilityId ? { facilityId: task.facilityId } : {}),
          },
        });
      }
      if (
        task.organizationId !== admission.organizationId ||
        (admission.clientId && task.clientId && task.clientId !== admission.clientId) ||
        (!admission.clientId && task.clientId)
      )
        throw new OnboardingTaskNotFoundError();
      await transaction
        .insert(admissionTasks)
        .values({
          tenantId: principal.tenantId,
          caseId: id,
          taskId,
          linkedByUserId: principal.userId,
          linkedAt: now,
        })
        .onConflictDoNothing();
      const updated = await this.touchCase(transaction, admission, now);
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.task_linked',
        resourceType: 'onboarding_case',
        metadata: { taskId },
        event: caseUpdatedEvent(principal, context, id, ['tasks'], updated.version),
      });
      return task;
    });
  }

  async linkCommunication(
    principal: AuthorizationPrincipal,
    id: string,
    interactionId: string,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertEditable(admission);
      if (!admission.clientId) throw new OnboardingClientLinkRequiredError();
      assertCan(principal, { action: 'client.read', resource: clientResource(admission) });
      assertCan(principal, { action: 'communications.read', resource: clientResource(admission) });
      const [interaction] = await transaction
        .select()
        .from(interactions)
        .where(
          and(eq(interactions.tenantId, principal.tenantId), eq(interactions.id, interactionId)),
        )
        .limit(1);
      if (!interaction || interaction.clientId !== admission.clientId)
        throw new OnboardingCommunicationNotFoundError();
      await transaction
        .insert(admissionCommunications)
        .values({
          tenantId: principal.tenantId,
          caseId: id,
          interactionId,
          linkedByUserId: principal.userId,
          linkedAt: now,
        })
        .onConflictDoNothing();
      const updated = await this.touchCase(transaction, admission, now);
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.communication_linked',
        resourceType: 'onboarding_case',
        metadata: { interactionId },
        event: caseUpdatedEvent(principal, context, id, ['communications'], updated.version),
      });
      return interaction;
    });
  }

  async recordProspectCommunication(
    principal: AuthorizationPrincipal,
    id: string,
    input: ProspectCommunicationInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertEditable(admission);
      if (admission.clientId)
        assertCan(principal, { action: 'client.read', resource: clientResource(admission) });
      const interaction = await this.communications.recordProspectInteractionWithinTransaction(
        transaction,
        principal,
        {
          caseId: admission.id,
          tenantId: admission.tenantId,
          organizationId: admission.organizationId,
          facilityId: admission.facilityId,
        },
        input,
        context,
        auditContext,
      );
      const updated = await this.touchCase(transaction, admission, now);
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.communication_recorded',
        resourceType: 'onboarding_case',
        metadata: { interactionId: interaction.id },
        event: caseUpdatedEvent(principal, context, id, ['communications'], updated.version),
      });
      return interaction;
    });
  }

  async linkFirstVisit(
    principal: AuthorizationPrincipal,
    id: string,
    input: { visitId: string; expectedVersion: number },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const admission = await this.requireCase(
        transaction,
        principal,
        id,
        'onboarding.manage',
        true,
      );
      this.assertOperationalFollowUpAllowed(admission);
      this.checkVersion(admission.version, input.expectedVersion);
      if (!admission.clientId) throw new OnboardingClientLinkRequiredError();
      if (!['preparation', 'ready_for_admission', 'admitted'].includes(admission.stage))
        throw new OnboardingFirstVisitStageInvalidError();
      const [visit] = await transaction
        .select()
        .from(visits)
        .where(and(eq(visits.tenantId, principal.tenantId), eq(visits.id, input.visitId)))
        .limit(1);
      if (
        !visit ||
        visit.clientId !== admission.clientId ||
        visit.organizationId !== admission.organizationId ||
        (admission.facilityId && visit.facilityId !== admission.facilityId) ||
        visit.status === 'cancelled'
      )
        throw new OnboardingVisitNotFoundError();
      assertCan(principal, {
        action: 'schedule.read',
        resource: {
          tenantId: visit.tenantId,
          clientId: visit.clientId,
          organizationId: visit.organizationId,
          facilityId: visit.facilityId,
        },
      });
      assertCan(principal, { action: 'client.read', resource: clientResource(admission) });
      const [updated] = await transaction
        .update(admissionCases)
        .set({
          firstVisitId: visit.id,
          version: admission.version + 1,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.id, id),
            eq(admissionCases.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.first_visit_linked',
        resourceType: 'onboarding_case',
        metadata: { visitId: visit.id },
        event: caseUpdatedEvent(principal, context, id, ['firstVisitId'], updated.version),
      });
      return redactCaseLinks(principal, updated);
    });
  }

  async listTemplates(principal: AuthorizationPrincipal, organizationId?: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const filters = this.visibleTemplates(principal, organizationId);
      const templates = await transaction
        .select()
        .from(checklistTemplates)
        .where(and(...filters))
        .orderBy(
          asc(checklistTemplates.organizationId),
          asc(checklistTemplates.facilityId),
          asc(checklistTemplates.name),
        );
      if (!templates.length) return [];
      const versions = or(
        ...templates.map((template) =>
          and(
            eq(checklistTemplateItems.templateId, template.id),
            eq(checklistTemplateItems.templateVersion, template.currentVersion),
          ),
        ),
      );
      const items = await transaction
        .select()
        .from(checklistTemplateItems)
        .where(and(eq(checklistTemplateItems.tenantId, principal.tenantId), versions))
        .orderBy(asc(checklistTemplateItems.sortOrder));
      const organizationIds = new Set(
        templates
          .filter((template) =>
            can(principal, {
              action: 'organization.read',
              resource: {
                tenantId: template.tenantId,
                organizationId: template.organizationId,
                ...(template.facilityId ? { facilityId: template.facilityId } : {}),
              },
            }),
          )
          .map((template) => template.organizationId),
      );
      const facilityIds = new Set(
        templates
          .filter(
            (template) =>
              template.facilityId &&
              can(principal, {
                action: 'facility.read',
                resource: {
                  tenantId: template.tenantId,
                  organizationId: template.organizationId,
                  facilityId: template.facilityId,
                },
              }),
          )
          .map((template) => template.facilityId!),
      );
      const [organizationRows, facilityRows] = await Promise.all([
        organizationIds.size
          ? transaction
              .select({ id: organizationsTable.id, name: organizationsTable.name })
              .from(organizationsTable)
              .where(
                and(
                  eq(organizationsTable.tenantId, principal.tenantId),
                  inArray(organizationsTable.id, [...organizationIds]),
                ),
              )
          : [],
        facilityIds.size
          ? transaction
              .select({ id: facilities.id, name: facilities.name })
              .from(facilities)
              .where(
                and(
                  eq(facilities.tenantId, principal.tenantId),
                  inArray(facilities.id, [...facilityIds]),
                ),
              )
          : [],
      ]);
      const organizationNames = new Map(organizationRows.map((row) => [row.id, row.name]));
      const facilityNames = new Map(facilityRows.map((row) => [row.id, row.name]));
      return templates.map((template) => ({
        ...template,
        organizationName: organizationNames.get(template.organizationId) ?? null,
        facilityName: template.facilityId ? (facilityNames.get(template.facilityId) ?? null) : null,
        items: items.filter((item) => item.templateId === template.id),
      }));
    });
  }

  async updateTemplate(
    principal: AuthorizationPrincipal,
    id: string,
    input: { expectedVersion: number; name: string; items: ChecklistItemInput[] },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    validateChecklistItems(input.items);
    if (!input.name.trim() || input.name.trim().length > 120)
      throw new InvalidChecklistTemplateError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [template] = await transaction
        .select()
        .from(checklistTemplates)
        .where(
          and(eq(checklistTemplates.tenantId, principal.tenantId), eq(checklistTemplates.id, id)),
        )
        .for('update')
        .limit(1);
      if (!template) throw new OnboardingTemplateNotFoundError();
      assertCan(principal, {
        action: 'onboarding.templates.manage',
        resource: {
          tenantId: template.tenantId,
          organizationId: template.organizationId,
          ...(template.facilityId ? { facilityId: template.facilityId } : {}),
        },
      });
      this.checkVersion(template.currentVersion, input.expectedVersion);
      const version = template.currentVersion + 1;
      const [updated] = await transaction
        .update(checklistTemplates)
        .set({
          name: input.name.trim(),
          currentVersion: version,
          updatedByUserId: principal.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(checklistTemplates.tenantId, principal.tenantId),
            eq(checklistTemplates.id, id),
            eq(checklistTemplates.currentVersion, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OnboardingVersionConflictError();
      await transaction.insert(checklistTemplateItems).values(
        input.items.map((item, sortOrder) => ({
          tenantId: principal.tenantId,
          templateId: id,
          templateVersion: version,
          ...item,
          category: item.category.trim(),
          label: item.label.trim(),
          sortOrder,
        })),
      );
      await this.record(transaction, principal, context, auditContext, {
        caseId: id,
        action: 'onboarding.template_updated',
        resourceType: 'onboarding_checklist_template',
        metadata: { version, itemCount: input.items.length },
        event: createDomainEvent({
          type: 'onboarding.template_updated',
          tenantId: principal.tenantId,
          aggregateType: 'onboarding',
          aggregateId: id,
          actor: { type: 'user', id: principal.userId },
          correlationId: context.correlationId,
          payload: { templateId: id, version },
        }),
      });
      return { ...updated, items: input.items };
    });
  }

  async clientHistory(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [client] = await transaction
        .select()
        .from(clientRecords)
        .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
        .limit(1);
      if (!client) throw new OnboardingCaseNotFoundError();
      assertCan(principal, { action: 'client.read', resource: clientResource(client) });
      assertCan(principal, { action: 'onboarding.read', resource: clientResource(client) });
      const cases = await transaction
        .select()
        .from(admissionCases)
        .where(
          and(
            eq(admissionCases.tenantId, principal.tenantId),
            eq(admissionCases.clientId, clientId),
          ),
        )
        .orderBy(desc(admissionCases.createdAt), desc(admissionCases.id))
        .limit(100);
      if (!cases.length) return [];
      const caseIds = cases.map((admission) => admission.id);
      const documentsReadable = can(principal, {
        action: 'documents.read',
        resource: clientResource(client),
      });
      const tasksReadable = can(principal, {
        action: 'operations.read',
        resource: clientResource(client),
      });
      const communicationsReadable = can(principal, {
        action: 'communications.read',
        resource: clientResource(client),
      });
      const documents = documentsReadable
        ? await transaction
            .select({
              caseId: admissionDocuments.caseId,
              id: documentArtifacts.id,
              requirementCode: admissionDocuments.requirementCode,
              status: documentArtifacts.status,
            })
            .from(admissionDocuments)
            .innerJoin(
              documentArtifacts,
              and(
                eq(documentArtifacts.tenantId, admissionDocuments.tenantId),
                eq(documentArtifacts.id, admissionDocuments.documentArtifactId),
              ),
            )
            .where(
              and(
                eq(admissionDocuments.tenantId, principal.tenantId),
                inArray(admissionDocuments.caseId, caseIds),
              ),
            )
        : [];
      const linkedTasks = tasksReadable
        ? await transaction
            .select({
              caseId: admissionTasks.caseId,
              id: tasks.id,
              title: tasks.title,
              status: tasks.status,
              dueAt: tasks.dueAt,
            })
            .from(admissionTasks)
            .innerJoin(
              tasks,
              and(eq(tasks.tenantId, admissionTasks.tenantId), eq(tasks.id, admissionTasks.taskId)),
            )
            .where(
              and(
                eq(admissionTasks.tenantId, principal.tenantId),
                inArray(admissionTasks.caseId, caseIds),
              ),
            )
        : [];
      const communications = communicationsReadable
        ? await transaction
            .select()
            .from(prospectInteractions)
            .where(
              and(
                eq(prospectInteractions.tenantId, principal.tenantId),
                inArray(prospectInteractions.caseId, caseIds),
              ),
            )
            .orderBy(desc(prospectInteractions.occurredAt), desc(prospectInteractions.id))
        : [];
      const transitions = await transaction
        .select()
        .from(admissionTransitions)
        .where(
          and(
            eq(admissionTransitions.tenantId, principal.tenantId),
            inArray(admissionTransitions.caseId, caseIds),
          ),
        )
        .orderBy(asc(admissionTransitions.version));
      const namedCases = await this.addCaseReferenceNames(transaction, principal, cases);
      const namedCaseById = new Map(namedCases.map((admission) => [admission.id, admission]));
      const readableVisitIds = cases
        .filter(
          (admission) =>
            admission.firstVisitId &&
            can(principal, { action: 'schedule.read', resource: clientResource(admission) }),
        )
        .map((admission) => admission.firstVisitId!);
      const firstVisits = readableVisitIds.length
        ? await transaction
            .select({ id: visits.id, plannedStart: visits.plannedStart })
            .from(visits)
            .where(
              and(
                eq(visits.tenantId, principal.tenantId),
                eq(visits.clientId, clientId),
                inArray(visits.id, readableVisitIds),
              ),
            )
        : [];
      const firstVisitById = new Map(firstVisits.map((visit) => [visit.id, visit]));
      const actorIds = [...new Set(transitions.map((entry) => entry.actorUserId))];
      const actorRows = actorIds.length
        ? await transaction
            .select({ id: users.id, displayName: users.displayName })
            .from(tenantMemberships)
            .innerJoin(users, eq(users.id, tenantMemberships.userId))
            .where(
              and(eq(tenantMemberships.tenantId, principal.tenantId), inArray(users.id, actorIds)),
            )
        : [];
      const actorNames = new Map(
        actorRows.flatMap((actor) =>
          actor.displayName ? [[actor.id, actor.displayName] as const] : [],
        ),
      );
      const documentsByCase = groupBy(documents, (row) => row.caseId);
      const tasksByCase = groupBy(linkedTasks, (row) => row.caseId);
      const communicationsByCase = groupBy(communications, (row) => row.caseId);
      const historyByCase = groupBy(transitions, (row) => row.caseId);
      return cases.map((admission) => {
        const firstVisitId = can(principal, {
          action: 'schedule.read',
          resource: clientResource(admission),
        })
          ? admission.firstVisitId
          : null;
        return {
          id: admission.id,
          stage: admission.stage,
          admittedAt: admission.admittedAt,
          ownerEmployeeId: admission.ownerEmployeeId,
          ownerEmployeeName: namedCaseById.get(admission.id)?.ownerEmployeeName ?? null,
          createdAt: admission.createdAt,
          firstVisitId,
          firstVisitStartsAt: firstVisitId
            ? (firstVisitById.get(firstVisitId)?.plannedStart ?? null)
            : null,
          documents: documentsByCase.get(admission.id) ?? [],
          tasks: tasksByCase.get(admission.id) ?? [],
          communications: communicationsByCase.get(admission.id) ?? [],
          history: (historyByCase.get(admission.id) ?? []).map((entry) => ({
            ...entry,
            actorName: actorNames.get(entry.actorUserId) ?? null,
          })),
        };
      });
    });
  }

  private async evaluateReadiness(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    admission: typeof admissionCases.$inferSelect,
  ): Promise<AdmissionReadiness> {
    const readiness = await this.evaluateReadinessBatch(transaction, principal, [admission]);
    return readiness.get(admission.id)!;
  }

  private async evaluateReadinessBatch(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    admissions: (typeof admissionCases.$inferSelect)[],
  ): Promise<Map<string, AdmissionReadiness>> {
    if (!admissions.length) return new Map();
    const today = new Date().toISOString().slice(0, 10);
    const caseIds = admissions.map((admission) => admission.id);
    const assessmentRows = await transaction
      .select()
      .from(admissionAssessments)
      .where(
        and(
          eq(admissionAssessments.tenantId, principal.tenantId),
          inArray(admissionAssessments.caseId, caseIds),
        ),
      );
    const responseRows = await transaction
      .select()
      .from(checklistResponses)
      .where(
        and(
          eq(checklistResponses.tenantId, principal.tenantId),
          inArray(checklistResponses.caseId, caseIds),
        ),
      );
    const assessments = new Map(assessmentRows.map((row) => [row.caseId, row.data]));
    const responsesByCase = groupBy(responseRows, (row) => row.caseId);

    const clientReadable = new Map(
      admissions.map((admission) => [
        admission.id,
        Boolean(
          admission.clientId &&
          can(principal, { action: 'client.read', resource: clientResource(admission) }),
        ),
      ]),
    );
    const clientIds = unique(
      admissions
        .filter((admission) => clientReadable.get(admission.id))
        .map((admission) => admission.clientId!),
    );
    const clientRows = clientIds.length
      ? await transaction
          .select()
          .from(clientRecords)
          .where(
            and(
              eq(clientRecords.tenantId, principal.tenantId),
              inArray(clientRecords.id, clientIds),
            ),
          )
      : [];
    const clientsById = new Map(clientRows.map((client) => [client.id, client]));
    const readableAdmissions = admissions.filter((admission) =>
      Boolean(admission.clientId && clientsById.has(admission.clientId)),
    );
    const readableClientIds = unique(readableAdmissions.map((admission) => admission.clientId!));

    const contactRows = readableClientIds.length
      ? await transaction
          .select({
            clientId: clientContactRoles.clientId,
            contactId: clientContacts.id,
            representationType: clientContacts.representationType,
            validFrom: clientContacts.representationValidFrom,
            validUntil: clientContacts.representationValidUntil,
            role: clientContactRoles.role,
          })
          .from(clientContactRoles)
          .innerJoin(
            clientContacts,
            and(
              eq(clientContacts.tenantId, clientContactRoles.tenantId),
              eq(clientContacts.clientId, clientContactRoles.clientId),
              eq(clientContacts.id, clientContactRoles.contactId),
            ),
          )
          .where(
            and(
              eq(clientContactRoles.tenantId, principal.tenantId),
              inArray(clientContactRoles.clientId, readableClientIds),
            ),
          )
      : [];
    const contactsByClient = new Map<
      string,
      Array<{
        roles: string[];
        representationType: string | null;
        validFrom: string | null;
        validUntil: string | null;
      }>
    >();
    const contactById = new Map<
      string,
      {
        clientId: string;
        roles: string[];
        representationType: string | null;
        validFrom: string | null;
        validUntil: string | null;
      }
    >();
    for (const row of contactRows) {
      const key = `${row.clientId}:${row.contactId}`;
      const contact = contactById.get(key) ?? {
        clientId: row.clientId,
        roles: [],
        representationType: row.representationType,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
      };
      contact.roles.push(row.role);
      contactById.set(key, contact);
    }
    for (const contact of contactById.values()) {
      const { clientId, ...value } = contact;
      contactsByClient.set(clientId, [...(contactsByClient.get(clientId) ?? []), value]);
    }

    const benefitsReadable = new Map(
      admissions.map((admission) => [
        admission.id,
        Boolean(
          clientsById.has(admission.clientId ?? '') &&
          can(principal, {
            action: 'benefits.read',
            resource: clientResource(admission),
          }),
        ),
      ]),
    );
    const benefitClientIds = unique(
      admissions
        .filter((admission) => benefitsReadable.get(admission.id))
        .map((admission) => admission.clientId!),
    );
    const fundingRows = benefitClientIds.length
      ? await transaction
          .select({ clientId: benefitFundingSources.clientId })
          .from(benefitFundingSources)
          .where(
            and(
              eq(benefitFundingSources.tenantId, principal.tenantId),
              inArray(benefitFundingSources.clientId, benefitClientIds),
              eq(benefitFundingSources.status, 'active'),
            ),
          )
      : [];
    const entitlementRows = benefitClientIds.length
      ? await transaction
          .select({ clientId: clientBenefitEntitlements.clientId })
          .from(clientBenefitEntitlements)
          .where(
            and(
              eq(clientBenefitEntitlements.tenantId, principal.tenantId),
              inArray(clientBenefitEntitlements.clientId, benefitClientIds),
              inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional']),
              lte(clientBenefitEntitlements.validFrom, today),
              or(
                isNull(clientBenefitEntitlements.validUntil),
                gte(clientBenefitEntitlements.validUntil, today),
              ),
            ),
          )
      : [];
    const fundingCounts = countBy(fundingRows, (row) => row.clientId);
    const entitlementCounts = countBy(entitlementRows, (row) => row.clientId);

    const agreementReadable = new Map(
      admissions.map((admission) => [
        admission.id,
        Boolean(
          clientsById.has(admission.clientId ?? '') &&
          can(principal, {
            action: 'service_agreement.read',
            resource: clientResource(admission),
          }),
        ),
      ]),
    );
    const agreementClientIds = unique(
      admissions
        .filter((admission) => agreementReadable.get(admission.id))
        .map((admission) => admission.clientId!),
    );
    const agreementRows = agreementClientIds.length
      ? await transaction
          .select({
            id: agreements.id,
            clientId: agreements.clientId,
            status: agreements.status,
            validFrom: agreements.validFrom,
            validUntil: agreements.validUntil,
          })
          .from(agreements)
          .where(
            and(
              eq(agreements.tenantId, principal.tenantId),
              inArray(agreements.clientId, agreementClientIds),
              inArray(agreements.status, ['draft', 'active']),
            ),
          )
      : [];
    const activeAgreementIds = agreementRows
      .filter((row) => row.status === 'active')
      .map((row) => row.id);
    const activeServiceRows = activeAgreementIds.length
      ? await transaction
          .select({
            agreementId: agreementServices.agreementId,
            serviceCode: agreementServices.serviceCode,
            serviceName: agreementServices.serviceName,
          })
          .from(agreementServices)
          .where(
            and(
              eq(agreementServices.tenantId, principal.tenantId),
              inArray(agreementServices.agreementId, activeAgreementIds),
              eq(agreementServices.status, 'active'),
            ),
          )
      : [];
    const agreementsByClient = groupBy(agreementRows, (row) => row.clientId);

    const visitReadable = new Map(
      admissions.map((admission) => [
        admission.id,
        Boolean(
          clientsById.has(admission.clientId ?? '') &&
          admission.firstVisitId &&
          can(principal, {
            action: 'schedule.read',
            resource: clientResource(admission),
          }),
        ),
      ]),
    );
    const visitIds = unique(
      admissions
        .filter((admission) => visitReadable.get(admission.id))
        .map((admission) => admission.firstVisitId!),
    );
    const visitRows = visitIds.length
      ? await transaction
          .select({ id: visits.id, clientId: visits.clientId, status: visits.status })
          .from(visits)
          .where(and(eq(visits.tenantId, principal.tenantId), inArray(visits.id, visitIds)))
      : [];
    const visitsById = new Map(visitRows.map((visit) => [visit.id, visit]));

    const documentsReadable = new Map(
      admissions.map((admission) => [
        admission.id,
        Boolean(
          clientsById.has(admission.clientId ?? '') &&
          can(principal, {
            action: 'documents.read',
            resource: clientResource(admission),
          }),
        ),
      ]),
    );
    const documentCaseIds = admissions
      .filter((admission) => documentsReadable.get(admission.id))
      .map((admission) => admission.id);
    const documentRows = documentCaseIds.length
      ? await transaction
          .select({
            caseId: admissionDocuments.caseId,
            requirementCode: admissionDocuments.requirementCode,
            status: documentArtifacts.status,
          })
          .from(admissionDocuments)
          .innerJoin(
            documentArtifacts,
            and(
              eq(documentArtifacts.tenantId, admissionDocuments.tenantId),
              eq(documentArtifacts.id, admissionDocuments.documentArtifactId),
            ),
          )
          .where(
            and(
              eq(admissionDocuments.tenantId, principal.tenantId),
              inArray(admissionDocuments.caseId, documentCaseIds),
            ),
          )
      : [];
    const documentsByCase = groupBy(documentRows, (row) => row.caseId);

    const templatePairs = admissions.filter(
      (admission) => admission.checklistTemplateId && admission.checklistTemplateVersion,
    );
    const templateItems = templatePairs.length
      ? await transaction
          .select()
          .from(checklistTemplateItems)
          .where(
            and(
              eq(checklistTemplateItems.tenantId, principal.tenantId),
              or(
                ...templatePairs.map((admission) =>
                  and(
                    eq(checklistTemplateItems.templateId, admission.checklistTemplateId!),
                    eq(checklistTemplateItems.templateVersion, admission.checklistTemplateVersion!),
                  ),
                ),
              ),
            ),
          )
          .orderBy(asc(checklistTemplateItems.sortOrder))
      : [];
    const itemsByTemplate = new Map<string, typeof templateItems>();
    for (const item of templateItems) {
      const key = `${item.templateId}:${item.templateVersion}`;
      itemsByTemplate.set(key, [...(itemsByTemplate.get(key) ?? []), item]);
    }

    const benefitWarningClientIds = unique(
      admissions
        .filter((admission) => {
          const clientId = admission.clientId;
          return (
            admission.fundingPlan === 'benefits' &&
            benefitsReadable.get(admission.id) &&
            clientId &&
            (fundingCounts.get(clientId) ?? 0) > 0 &&
            (entitlementCounts.get(clientId) ?? 0) > 0
          );
        })
        .map((admission) => admission.clientId!),
    );
    const insuranceClientIds = benefitWarningClientIds.length
      ? new Set(
          (
            await transaction
              .select({ clientId: clientInsurances.clientId })
              .from(clientInsurances)
              .where(
                and(
                  eq(clientInsurances.tenantId, principal.tenantId),
                  inArray(clientInsurances.clientId, benefitWarningClientIds),
                  eq(clientInsurances.insuranceType, 'pflegeversicherung'),
                ),
              )
          ).map((row) => row.clientId),
        )
      : new Set<string>();
    const gradeClientIds = benefitWarningClientIds.length
      ? new Set(
          (
            await transaction
              .select({ clientId: pflegegradRecords.clientId })
              .from(pflegegradRecords)
              .where(
                and(
                  eq(pflegegradRecords.tenantId, principal.tenantId),
                  inArray(pflegegradRecords.clientId, benefitWarningClientIds),
                  eq(pflegegradRecords.status, 'confirmed'),
                  lte(pflegegradRecords.validFrom, today),
                  or(
                    isNull(pflegegradRecords.validUntil),
                    gte(pflegegradRecords.validUntil, today),
                  ),
                ),
              )
          ).map((row) => row.clientId),
        )
      : new Set<string>();

    const results = new Map<string, AdmissionReadiness>();
    for (const admission of admissions) {
      const findings: ReadinessFinding[] = [];
      const clientRead = clientReadable.get(admission.id) ?? false;
      const client = clientsById.get(admission.clientId ?? '') ?? null;
      const primaryContacts = (contactsByClient.get(client?.id ?? '') ?? []).filter((contact) =>
        contact.roles.includes('primary_contact'),
      );
      const isBenefitsReadable = benefitsReadable.get(admission.id) ?? false;
      const activeFundingCount = client ? (fundingCounts.get(client.id) ?? 0) : 0;
      const entitlementCount = client ? (entitlementCounts.get(client.id) ?? 0) : 0;
      const agreementPermission = agreementReadable.get(admission.id) ?? false;
      const date = admission.preferredStartDate ?? today;
      const requestedServices =
        assessments.get(admission.id)?.requestedServices ?? admission.requestedServices;
      const requestedServiceNames = requestedServices.map(normalizeName).filter(Boolean);
      const applicableAgreements = client
        ? (agreementsByClient.get(client.id) ?? []).filter(
            (row) => row.validFrom <= date && (!row.validUntil || row.validUntil >= date),
          )
        : [];
      const activeIds = new Set(
        applicableAgreements.filter((row) => row.status === 'active').map((row) => row.id),
      );
      const applicableActiveServices = activeServiceRows.filter((row) =>
        activeIds.has(row.agreementId),
      );
      const coversRequestedServices =
        requestedServiceNames.length > 0 &&
        requestedServiceNames.every((requested) =>
          applicableActiveServices.some((row) =>
            [row.serviceCode, row.serviceName].some((value) => normalizeName(value) === requested),
          ),
        );
      const agreementState: 'missing' | 'draft' | 'active' | 'denied' | 'services_mismatch' =
        !client
          ? 'missing'
          : !agreementPermission
            ? 'denied'
            : applicableActiveServices.length &&
                (!requestedServiceNames.length || coversRequestedServices)
              ? 'active'
              : activeIds.size > 0
                ? 'services_mismatch'
                : applicableAgreements.length
                  ? 'draft'
                  : 'missing';
      const visit = admission.firstVisitId ? visitsById.get(admission.firstVisitId) : undefined;
      const visitPlanned = Boolean(
        client &&
        visitReadable.get(admission.id) &&
        visit?.clientId === client.id &&
        visit.status !== 'cancelled',
      );
      const documents = documentsByCase.get(admission.id) ?? [];
      const items =
        admission.checklistTemplateId && admission.checklistTemplateVersion
          ? (itemsByTemplate.get(
              `${admission.checklistTemplateId}:${admission.checklistTemplateVersion}`,
            ) ?? [])
          : [];
      const responses = responsesByCase.get(admission.id) ?? [];
      for (const item of items) {
        const response = responses.find(
          (entry) =>
            entry.itemCode === item.code &&
            entry.templateVersion === admission.checklistTemplateVersion,
        );
        if (item.source === 'automatic') {
          const result = automaticItemStatus(item.code, {
            admission,
            client,
            clientReadable: clientRead,
            primaryContacts,
            assessment: assessments.get(admission.id) ?? null,
            activeFundingCount,
            entitlementCount,
            benefitsReadable: isBenefitsReadable,
            fundingPlanDetails: admission.fundingPlanDetails,
            agreementState,
            visitPlanned,
          });
          findings.push({
            code: item.code,
            category: item.category,
            label: item.label,
            mandatory: item.mandatory,
            severity: result.complete ? 'complete' : item.mandatory ? 'blocker' : 'warning',
            ...(result.detail ? { detail: result.detail } : {}),
            ...(result.detailCode ? { detailCode: result.detailCode } : {}),
          });
        } else if (item.source === 'document') {
          const found = documents.some(
            (document) => document.requirementCode === item.code && document.status === 'ready',
          );
          findings.push({
            code: item.code,
            category: item.category,
            label: item.label,
            mandatory: item.mandatory,
            severity: found ? 'complete' : item.mandatory ? 'blocker' : 'warning',
            ...(!found
              ? {
                  detailCode: documentsReadable.get(admission.id)
                    ? 'DOCUMENT_EVIDENCE_MISSING'
                    : 'DOCUMENT_ACCESS_REQUIRED',
                }
              : {}),
          });
        } else if (response?.status === 'not_applicable') {
          findings.push({
            code: item.code,
            category: item.category,
            label: item.label,
            mandatory: item.mandatory,
            severity: 'not_applicable',
            ...(response.reason ? { detail: response.reason } : {}),
          });
        } else if (response?.status === 'complete') {
          findings.push({
            code: item.code,
            category: item.category,
            label: item.label,
            mandatory: item.mandatory,
            severity: 'complete',
          });
        } else {
          findings.push({
            code: item.code,
            category: item.category,
            label: item.label,
            mandatory: item.mandatory,
            severity: item.mandatory ? 'blocker' : 'warning',
          });
        }
      }
      if (
        primaryContacts.some(
          (contact) =>
            contactAuthorizationFor({
              roles: contact.roles,
              representationType: contact.representationType,
              validFrom: contact.validFrom,
              validUntil: contact.validUntil,
              today,
            }) === 'not_confirmed',
        )
      ) {
        findings.push({
          code: 'CONTACT_AUTHORITY_UNCONFIRMED',
          category: 'contact_and_representation',
          label: 'Contact authority is not confirmed',
          mandatory: false,
          severity: 'warning',
        });
      }
      if (
        admission.fundingPlan === 'benefits' &&
        isBenefitsReadable &&
        activeFundingCount > 0 &&
        entitlementCount > 0
      ) {
        findings.push({
          code: 'FUNDING_BALANCE_UNKNOWN',
          category: 'funding_arrangement',
          label: 'Available insurer balance is unknown',
          mandatory: false,
          severity: 'warning',
          detail: 'Unknown balance is not zero and is not a funding guarantee.',
          detailCode: 'UNKNOWN_BALANCE_NOT_GUARANTEE',
        });
        if (client && !insuranceClientIds.has(client.id))
          findings.push({
            code: 'FUNDING_INSURANCE_UNKNOWN',
            category: 'funding_arrangement',
            label: 'Care insurance details are missing',
            mandatory: false,
            severity: 'warning',
          });
        if (client && !gradeClientIds.has(client.id))
          findings.push({
            code: 'FUNDING_CARE_GRADE_UNKNOWN',
            category: 'funding_arrangement',
            label: 'Pflegegrad is not recorded',
            mandatory: false,
            severity: 'warning',
          });
      }
      if (admission.fundingPlan === 'other' && admission.fundingPlanDetails?.trim())
        findings.push({
          code: 'FUNDING_ARRANGEMENT_REQUIRES_REVIEW',
          category: 'funding_arrangement',
          label: 'Provider-specific funding arrangement needs review',
          mandatory: false,
          severity: 'warning',
        });
      const blockers = findings.filter((finding) => finding.severity === 'blocker');
      results.set(admission.id, {
        caseId: admission.id,
        caseVersion: admission.version,
        stage: admission.stage,
        canAdmit: blockers.length === 0,
        fundingBalance: admission.fundingPlan === 'benefits' ? 'unknown' : 'not_applicable',
        findings,
        blockers,
        warnings: findings.filter((finding) => finding.severity === 'warning'),
      });
    }
    return results;
  }

  private async requireCase(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    id: string,
    permission: 'onboarding.read' | 'onboarding.manage' | 'onboarding.admit',
    lock = false,
  ) {
    const query = transaction
      .select()
      .from(admissionCases)
      .where(and(eq(admissionCases.tenantId, principal.tenantId), eq(admissionCases.id, id)));
    const [admission] = lock ? await query.for('update').limit(1) : await query.limit(1);
    if (!admission || !can(principal, { action: permission, resource: caseResource(admission) }))
      throw new OnboardingCaseNotFoundError();
    return admission;
  }

  private visibleCases(principal: AuthorizationPrincipal) {
    const grants = principal.grants.filter((grant) => grant.permission === 'onboarding.read');
    const scopes = [];
    if (
      grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
    )
      scopes.push(eq(admissionCases.tenantId, principal.tenantId));
    const organizationIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ];
    const facilityIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ];
    if (organizationIds.length)
      scopes.push(inArray(admissionCases.organizationId, organizationIds));
    if (facilityIds.length) scopes.push(inArray(admissionCases.facilityId, facilityIds));
    if (!scopes.length) throw new AuthorizationDeniedError('onboarding.read');
    return [eq(admissionCases.tenantId, principal.tenantId), or(...scopes)!];
  }

  private visibleTemplates(principal: AuthorizationPrincipal, organizationId?: string) {
    const grants = principal.grants.filter(
      (grant) =>
        grant.permission === 'onboarding.read' ||
        grant.permission === 'onboarding.templates.manage',
    );
    const scopes = [];
    if (
      grants.some((grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId)
    )
      scopes.push(eq(checklistTemplates.tenantId, principal.tenantId));
    const organizationIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ];
    const facilityIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ];
    if (organizationIds.length)
      scopes.push(inArray(checklistTemplates.organizationId, organizationIds));
    if (facilityIds.length) scopes.push(inArray(checklistTemplates.facilityId, facilityIds));
    if (!scopes.length) throw new AuthorizationDeniedError('onboarding.read');
    return [
      eq(checklistTemplates.tenantId, principal.tenantId),
      or(...scopes)!,
      ...(organizationId ? [eq(checklistTemplates.organizationId, organizationId)] : []),
    ];
  }

  private async validateProvider(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
    facilityId: string | null,
  ) {
    const [organization] = await transaction
      .select({ status: organizationsTable.status })
      .from(organizationsTable)
      .where(
        and(eq(organizationsTable.tenantId, tenantId), eq(organizationsTable.id, organizationId)),
      )
      .limit(1);
    if (!organization || organization.status !== 'active')
      throw new OnboardingProviderNotFoundError();
    if (facilityId) {
      const [facility] = await transaction
        .select({ organizationId: facilities.organizationId, status: facilities.status })
        .from(facilities)
        .where(and(eq(facilities.tenantId, tenantId), eq(facilities.id, facilityId)))
        .limit(1);
      if (!facility || facility.organizationId !== organizationId || facility.status !== 'active')
        throw new OnboardingProviderNotFoundError();
    }
  }

  private async validateOwner(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    organizationId: string,
    employeeId: string,
  ) {
    const [employee] = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.tenantId, principal.tenantId),
          eq(employeeRecords.id, employeeId),
          eq(employeeRecords.organizationId, organizationId),
          eq(employeeRecords.status, 'active'),
        ),
      )
      .limit(1);
    if (!employee) throw new OnboardingOwnerNotFoundError();
    assertCan(principal, {
      action: 'employee.read',
      resource: { tenantId: principal.tenantId, organizationId },
    });
  }

  private async validateClientLink(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    resource: CaseResource,
    firstName: string,
    lastName: string,
    reason?: string,
  ) {
    const client = await this.getClient(transaction, principal.tenantId, clientId);
    if (
      !client ||
      client.status === 'archived' ||
      client.organizationId !== resource.organizationId ||
      (resource.facilityId && client.primaryFacilityId !== resource.facilityId)
    )
      throw new OnboardingClientLinkInvalidError();
    assertCan(principal, { action: 'client.read', resource: clientResource(client) });
    if (
      (normalizeName(firstName) !== normalizeName(client.firstName) ||
        normalizeName(lastName) !== normalizeName(client.lastName)) &&
      !reason?.trim()
    )
      throw new OnboardingClientLinkReasonRequiredError();
    return client;
  }

  private async getClient(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    const [client] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, tenantId), eq(clientRecords.id, clientId)))
      .limit(1);
    return client ?? null;
  }

  private async ensureDefaultTemplate(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    organizationId: string,
  ) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${principal.tenantId + ':' + organizationId + ':onboarding-default'}, 0))`,
    );
    const [existing] = await transaction
      .select()
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.tenantId, principal.tenantId),
          eq(checklistTemplates.organizationId, organizationId),
          isNull(checklistTemplates.facilityId),
          eq(checklistTemplates.name, 'Default'),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const template = {
      id: uuidv7(),
      tenantId: principal.tenantId,
      organizationId,
      facilityId: null,
      name: 'Default',
      currentVersion: 1,
      updatedByUserId: principal.userId,
      updatedAt: new Date(),
    };
    await transaction.insert(checklistTemplates).values(template);
    await transaction.insert(checklistTemplateItems).values(
      DEFAULT_CHECKLIST_ITEMS.map((item, sortOrder) => ({
        tenantId: principal.tenantId,
        templateId: template.id,
        templateVersion: 1,
        ...item,
        sortOrder,
      })),
    );
    return template;
  }

  private async requireChecklistItem(
    transaction: DatabaseTransaction,
    tenantId: string,
    admission: typeof admissionCases.$inferSelect,
    code: string,
    source: 'manual' | 'document',
  ) {
    if (!admission.checklistTemplateId || !admission.checklistTemplateVersion)
      throw new OnboardingChecklistItemNotFoundError();
    const [item] = await transaction
      .select()
      .from(checklistTemplateItems)
      .where(
        and(
          eq(checklistTemplateItems.tenantId, tenantId),
          eq(checklistTemplateItems.templateId, admission.checklistTemplateId),
          eq(checklistTemplateItems.templateVersion, admission.checklistTemplateVersion),
          eq(checklistTemplateItems.code, code),
        ),
      )
      .limit(1);
    if (!item || item.source !== source) throw new OnboardingChecklistItemNotFoundError();
    return item;
  }

  private async touchCase(
    transaction: DatabaseTransaction,
    admission: typeof admissionCases.$inferSelect,
    now: Date,
  ) {
    const [updated] = await transaction
      .update(admissionCases)
      .set({ version: admission.version + 1, lastActivityAt: now, updatedAt: now })
      .where(
        and(
          eq(admissionCases.tenantId, admission.tenantId),
          eq(admissionCases.id, admission.id),
          eq(admissionCases.version, admission.version),
        ),
      )
      .returning();
    if (!updated) throw new OnboardingVersionConflictError();
    return updated;
  }

  private checkVersion(actual: number, expected: number) {
    if (!Number.isInteger(expected) || expected !== actual)
      throw new OnboardingVersionConflictError();
  }

  private assertEditable(admission: typeof admissionCases.$inferSelect) {
    if (admission.stage === 'admitted') throw new OnboardingDecisionImmutableError();
  }

  private assertOperationalFollowUpAllowed(admission: typeof admissionCases.$inferSelect) {
    if (admission.stage === 'declined' || admission.stage === 'withdrawn')
      throw new OnboardingCaseClosedError();
  }

  private async record(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    context: RequestContext,
    auditContext: AuditContext,
    input: {
      caseId: string;
      action: string;
      resourceType: string;
      metadata: Record<string, unknown>;
      event: ReturnType<typeof createDomainEvent>;
    },
  ) {
    const now = new Date();
    await this.audit.append(transaction, {
      id: input.event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.caseId,
      timestamp: now,
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, input.event);
  }
}

function admissionSortOrder(
  sortBy: NonNullable<AdmissionSearchQuery['sortBy']>,
  direction: NonNullable<AdmissionSearchQuery['sortDirection']>,
) {
  const isAscending = direction === 'asc';
  if (sortBy === 'name') {
    const lastName = sql`lower(${admissionCases.lastName})`;
    const firstName = sql`lower(${admissionCases.firstName})`;
    return isAscending
      ? [asc(lastName), asc(firstName), asc(admissionCases.id)]
      : [desc(lastName), desc(firstName), desc(admissionCases.id)];
  }
  if (sortBy === 'nextFollowUpAt') {
    const dateOrder = isAscending ? sql`asc` : sql`desc`;
    const idOrder = isAscending ? sql`asc` : sql`desc`;
    return [
      sql`${admissionCases.nextFollowUpAt} ${dateOrder} nulls last`,
      sql`${admissionCases.id} ${idOrder}`,
    ];
  }
  const column = sortBy === 'createdAt' ? admissionCases.createdAt : admissionCases.lastActivityAt;
  return isAscending
    ? [asc(column), asc(admissionCases.id)]
    : [desc(column), desc(admissionCases.id)];
}

function automaticItemStatus(
  code: string,
  facts: {
    admission: typeof admissionCases.$inferSelect;
    client: typeof clientRecords.$inferSelect | null;
    clientReadable: boolean;
    primaryContacts: Array<{ roles: string[] }>;
    assessment: NeedsAssessment | null;
    activeFundingCount: number;
    entitlementCount: number;
    benefitsReadable: boolean;
    fundingPlanDetails: string | null;
    agreementState: 'missing' | 'draft' | 'active' | 'denied' | 'services_mismatch';
    visitPlanned: boolean;
  },
): { complete: boolean; detail?: string; detailCode?: string } {
  switch (code) {
    case 'client_identity':
      return {
        complete: Boolean(
          facts.client?.firstName.trim() &&
          facts.client.lastName.trim() &&
          facts.client.organizationId &&
          facts.client.primaryFacilityId,
        ),
        ...(!facts.clientReadable && facts.admission.clientId
          ? {
              detail: 'Client access is required to verify identity.',
              detailCode: 'CLIENT_ACCESS_REQUIRED_IDENTITY',
            }
          : {}),
      };
    case 'primary_contact':
      return {
        complete: facts.primaryContacts.length > 0,
        ...(!facts.clientReadable && facts.admission.clientId
          ? {
              detail: 'Client access is required to verify the primary contact.',
              detailCode: 'CLIENT_ACCESS_REQUIRED_CONTACT',
            }
          : {}),
      };
    case 'needs_assessment':
      return { complete: needsAssessmentComplete(facts.assessment) };
    case 'funding_arrangement':
      if (facts.admission.fundingPlan === 'private_pay') return { complete: true };
      if (facts.admission.fundingPlan === 'benefits') {
        if (!facts.benefitsReadable)
          return {
            complete: false,
            detail: 'Benefits access is required to verify this arrangement.',
            detailCode: 'BENEFITS_ACCESS_REQUIRED',
          };
        return {
          complete: facts.activeFundingCount > 0 && facts.entitlementCount > 0,
          detail:
            facts.activeFundingCount === 0
              ? 'No active Benefits funding source is recorded.'
              : 'No current confirmed or provisional entitlement is recorded.',
          detailCode:
            facts.activeFundingCount === 0 ? 'FUNDING_SOURCE_MISSING' : 'ENTITLEMENT_MISSING',
        };
      }
      if (facts.admission.fundingPlan === 'other')
        return facts.fundingPlanDetails?.trim()
          ? { complete: true }
          : {
              complete: false,
              detail: 'Describe the provider-specific funding arrangement.',
              detailCode: 'FUNDING_PLAN_DETAILS_MISSING',
            };
      return {
        complete: false,
        detail: 'Choose private payment or confirm an arrangement in Benefits.',
        detailCode: 'FUNDING_PLAN_MISSING',
      };
    case 'service_agreement':
      if (facts.agreementState === 'active') return { complete: true };
      if (facts.agreementState === 'denied')
        return {
          complete: false,
          detail: 'Service agreement access is required to verify acceptance.',
          detailCode: 'AGREEMENT_ACCESS_REQUIRED',
        };
      if (facts.agreementState === 'services_mismatch')
        return {
          complete: false,
          detail: 'The active service agreement does not cover every requested service.',
          detailCode: 'AGREEMENT_SERVICES_MISSING',
        };
      return {
        complete: false,
        detail:
          facts.agreementState === 'draft'
            ? 'Agreement exists but is not active.'
            : 'No applicable service agreement exists.',
        detailCode: facts.agreementState === 'draft' ? 'AGREEMENT_DRAFT' : 'AGREEMENT_MISSING',
      };
    case 'first_visit':
      return { complete: facts.visitPlanned };
    default:
      return { complete: false };
  }
}

function groupBy<T, K>(items: readonly T[], keyFor: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function countBy<T, K>(items: readonly T[], keyFor: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function validateCaseInput(input: AdmissionCaseInput) {
  if (
    !input.organizationId ||
    !input.firstName.trim() ||
    input.firstName.trim().length > 120 ||
    !input.lastName.trim() ||
    input.lastName.trim().length > 120 ||
    !input.inquirySource.trim() ||
    input.inquirySource.trim().length > 120
  ) {
    throw new InvalidAdmissionCaseInputError();
  }
  if (
    input.requestedServices &&
    (input.requestedServices.length > 20 ||
      input.requestedServices.some((value) => !value.trim() || value.trim().length > 80))
  )
    throw new InvalidAdmissionCaseInputError();
  if (input.preferredStartDate && !isISODate(input.preferredStartDate))
    throw new InvalidAdmissionCaseInputError();
  if (input.nextFollowUpAt && Number.isNaN(input.nextFollowUpAt.getTime()))
    throw new InvalidAdmissionCaseInputError();
  if (
    (input.requesterName?.length ?? 0) > 160 ||
    (input.requesterRelationship?.length ?? 0) > 120 ||
    (input.contactEmail?.length ?? 0) > 254 ||
    (input.contactPhone?.length ?? 0) > 80 ||
    (input.serviceLocation?.length ?? 0) > 500 ||
    (input.fundingPlanDetails?.length ?? 0) > 1000 ||
    (input.initialNotes?.length ?? 0) > 4000
  )
    throw new InvalidAdmissionCaseInputError();
}

function validateCaseChanges(changes: AdmissionCaseChanges) {
  if (!Number.isInteger(changes.expectedVersion) || changes.expectedVersion < 1)
    throw new InvalidAdmissionCaseInputError();
  if (
    changes.firstName !== undefined &&
    (!changes.firstName.trim() || changes.firstName.trim().length > 120)
  )
    throw new InvalidAdmissionCaseInputError();
  if (
    changes.lastName !== undefined &&
    (!changes.lastName.trim() || changes.lastName.trim().length > 120)
  )
    throw new InvalidAdmissionCaseInputError();
  if (
    changes.inquirySource !== undefined &&
    (!changes.inquirySource.trim() || changes.inquirySource.trim().length > 120)
  )
    throw new InvalidAdmissionCaseInputError();
  if (
    changes.requestedServices &&
    (changes.requestedServices.length > 20 ||
      changes.requestedServices.some((value) => !value.trim() || value.trim().length > 80))
  )
    throw new InvalidAdmissionCaseInputError();
  if (changes.preferredStartDate && !isISODate(changes.preferredStartDate))
    throw new InvalidAdmissionCaseInputError();
  if (changes.nextFollowUpAt instanceof Date && Number.isNaN(changes.nextFollowUpAt.getTime()))
    throw new InvalidAdmissionCaseInputError();
  if ((changes.fundingPlanDetails?.length ?? 0) > 1000) throw new InvalidAdmissionCaseInputError();
}

function caseResource(admission: {
  tenantId: string;
  organizationId: string;
  facilityId: string | null;
  clientId?: string | null;
}): CaseResource {
  return {
    tenantId: admission.tenantId,
    organizationId: admission.organizationId,
    ...(admission.facilityId ? { facilityId: admission.facilityId } : {}),
    ...(admission.clientId ? { clientId: admission.clientId } : {}),
  };
}

function clientResource(
  resource: typeof admissionCases.$inferSelect | typeof clientRecords.$inferSelect,
): CaseResource {
  if ('clientId' in resource) return caseResource(resource);
  return {
    tenantId: resource.tenantId,
    clientId: resource.id,
    ...(resource.organizationId ? { organizationId: resource.organizationId } : {}),
    ...(resource.primaryFacilityId ? { facilityId: resource.primaryFacilityId } : {}),
  };
}

function redactCaseLinks<T extends typeof admissionCases.$inferSelect>(
  principal: AuthorizationPrincipal,
  admission: T,
): T {
  const resource = caseResource(admission);
  const clientReadable = can(principal, { action: 'client.read', resource });
  const scheduleReadable = can(principal, { action: 'schedule.read', resource });
  return {
    ...admission,
    clientId: clientReadable ? admission.clientId : null,
    firstVisitId: scheduleReadable ? admission.firstVisitId : null,
    decisionSnapshot: clientReadable ? admission.decisionSnapshot : null,
  };
}

function caseUpdatedEvent(
  principal: AuthorizationPrincipal,
  context: RequestContext,
  id: string,
  changedFields: string[],
  version: number,
) {
  return createDomainEvent({
    type: 'onboarding.case_updated',
    tenantId: principal.tenantId,
    aggregateType: 'onboarding',
    aggregateId: id,
    actor: { type: 'user', id: principal.userId },
    correlationId: context.correlationId,
    payload: { caseId: id, changedFields, version },
  });
}

function stageEvent(
  principal: AuthorizationPrincipal,
  context: RequestContext,
  id: string,
  fromStage: AdmissionStage,
  toStage: AdmissionStage,
  version: number,
) {
  if (toStage === 'declined' || toStage === 'withdrawn')
    return createDomainEvent({
      type: toStage === 'declined' ? 'onboarding.declined' : 'onboarding.withdrawn',
      tenantId: principal.tenantId,
      aggregateType: 'onboarding',
      aggregateId: id,
      actor: { type: 'user', id: principal.userId },
      correlationId: context.correlationId,
      payload: { caseId: id, version },
    });
  return createDomainEvent({
    type: 'onboarding.stage_changed',
    tenantId: principal.tenantId,
    aggregateType: 'onboarding',
    aggregateId: id,
    actor: { type: 'user', id: principal.userId },
    correlationId: context.correlationId,
    payload: { caseId: id, fromStage, toStage, version },
  });
}

function trimOrNull(value: string | null | undefined) {
  return value?.trim() || null;
}
function readinessSummary(readiness: AdmissionReadiness) {
  return {
    canAdmit: readiness.canAdmit,
    blockerCount: readiness.blockers.length,
    warningCount: readiness.warnings.length,
  };
}
function normalizeName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}
function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
function isISODate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class InvalidOnboardingQueryError extends Error {
  readonly code = 'ONBOARDING_INVALID_QUERY';
  constructor() {
    super('The onboarding query is invalid');
    this.name = 'InvalidOnboardingQueryError';
  }
}
export class InvalidAdmissionCaseInputError extends Error {
  readonly code = 'ONBOARDING_INVALID_INPUT';
  constructor() {
    super('The admission case input is invalid');
    this.name = 'InvalidAdmissionCaseInputError';
  }
}
export class OnboardingCaseNotFoundError extends Error {
  readonly code = 'ONBOARDING_CASE_NOT_FOUND';
  constructor() {
    super('The admission case was not found');
    this.name = 'OnboardingCaseNotFoundError';
  }
}
export class OnboardingVersionConflictError extends Error {
  readonly code = 'ONBOARDING_VERSION_CONFLICT';
  constructor() {
    super('The admission case changed; reload it and retry');
    this.name = 'OnboardingVersionConflictError';
  }
}
export class OnboardingProviderNotFoundError extends Error {
  readonly code = 'ONBOARDING_PROVIDER_NOT_FOUND';
  constructor() {
    super('The provider context was not found');
    this.name = 'OnboardingProviderNotFoundError';
  }
}
export class OnboardingOwnerNotFoundError extends Error {
  readonly code = 'ONBOARDING_OWNER_NOT_FOUND';
  constructor() {
    super('The onboarding owner was not found');
    this.name = 'OnboardingOwnerNotFoundError';
  }
}
export class OnboardingClientLinkInvalidError extends Error {
  readonly code = 'ONBOARDING_CLIENT_LINK_INVALID';
  constructor() {
    super('The client cannot be linked to this admission case');
    this.name = 'OnboardingClientLinkInvalidError';
  }
}
export class OnboardingClientLinkReasonRequiredError extends Error {
  readonly code = 'ONBOARDING_CLIENT_LINK_REASON_REQUIRED';
  constructor() {
    super('A reason is required when client identity differs');
    this.name = 'OnboardingClientLinkReasonRequiredError';
  }
}
export class OnboardingClientLinkRequiredError extends Error {
  readonly code = 'ONBOARDING_CLIENT_LINK_REQUIRED';
  constructor() {
    super('Link a client before using this source record');
    this.name = 'OnboardingClientLinkRequiredError';
  }
}

export class OnboardingFacilityRequiredError extends Error {
  readonly code = 'ONBOARDING_FACILITY_REQUIRED';
  constructor() {
    super('Assign a facility before registering the prospect as a client');
    this.name = 'OnboardingFacilityRequiredError';
  }
}

export class OnboardingCaseClosedError extends Error {
  readonly code = 'ONBOARDING_CASE_CLOSED';
  constructor() {
    super('A declined or withdrawn admission cannot receive follow-up links');
    this.name = 'OnboardingCaseClosedError';
  }
}
export class OnboardingReadinessBlockedError extends Error {
  readonly code = 'ONBOARDING_READINESS_BLOCKED';
  constructor(readonly blockers: ReadinessFinding[]) {
    super('Mandatory admission requirements remain outstanding');
    this.name = 'OnboardingReadinessBlockedError';
  }
}
export class OnboardingNotReadyForAdmissionError extends Error {
  readonly code = 'ONBOARDING_NOT_READY_FOR_ADMISSION';
  constructor() {
    super('Move the case to ready for admission before admitting');
    this.name = 'OnboardingNotReadyForAdmissionError';
  }
}
export class OnboardingDecisionReasonRequiredError extends Error {
  readonly code = 'ONBOARDING_REASON_REQUIRED';
  constructor() {
    super('A reason is required for this decision');
    this.name = 'OnboardingDecisionReasonRequiredError';
  }
}
export class OnboardingDecisionImmutableError extends Error {
  readonly code = 'ONBOARDING_DECISION_IMMUTABLE';
  constructor() {
    super('An admitted case cannot be changed');
    this.name = 'OnboardingDecisionImmutableError';
  }
}
export class OnboardingChecklistItemNotFoundError extends Error {
  readonly code = 'ONBOARDING_CHECKLIST_ITEM_NOT_FOUND';
  constructor() {
    super('The checklist item was not found or is not manually managed');
    this.name = 'OnboardingChecklistItemNotFoundError';
  }
}
export class InvalidChecklistResponseError extends Error {
  readonly code = 'ONBOARDING_INVALID_CHECKLIST_RESPONSE';
  constructor() {
    super('The checklist response is invalid');
    this.name = 'InvalidChecklistResponseError';
  }
}
export class OnboardingDocumentNotFoundError extends Error {
  readonly code = 'ONBOARDING_DOCUMENT_NOT_FOUND';
  constructor() {
    super('The document is unavailable for this client');
    this.name = 'OnboardingDocumentNotFoundError';
  }
}
export class OnboardingTaskNotFoundError extends Error {
  readonly code = 'ONBOARDING_TASK_NOT_FOUND';
  constructor() {
    super('The operations task was not found');
    this.name = 'OnboardingTaskNotFoundError';
  }
}
export class OnboardingCommunicationNotFoundError extends Error {
  readonly code = 'ONBOARDING_COMMUNICATION_NOT_FOUND';
  constructor() {
    super('The communication was not found for this client');
    this.name = 'OnboardingCommunicationNotFoundError';
  }
}
export class OnboardingVisitNotFoundError extends Error {
  readonly code = 'ONBOARDING_VISIT_NOT_FOUND';
  constructor() {
    super('The planned visit was not found for this client');
    this.name = 'OnboardingVisitNotFoundError';
  }
}
export class OnboardingFirstVisitStageInvalidError extends Error {
  readonly code = 'ONBOARDING_FIRST_VISIT_STAGE_INVALID';
  constructor() {
    super('The admission case must be in preparation before planning its first visit');
    this.name = 'OnboardingFirstVisitStageInvalidError';
  }
}
export class OnboardingTemplateNotFoundError extends Error {
  readonly code = 'ONBOARDING_TEMPLATE_NOT_FOUND';
  constructor() {
    super('The checklist template was not found');
    this.name = 'OnboardingTemplateNotFoundError';
  }
}

export function createOnboardingApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  clients: Pick<ClientApplicationService, 'activateWithinTransaction' | 'createWithinTransaction'>,
  communications: Pick<
    CommunicationsApplicationService,
    'recordProspectInteractionWithinTransaction'
  >,
  services: Pick<ServiceApplicationService, 'search'>,
  prices: Pick<ServicePriceApplicationService, 'list'>,
) {
  return new OnboardingApplicationService(
    unitOfWork,
    audit,
    outbox,
    clients,
    communications,
    services,
    prices,
  );
}
