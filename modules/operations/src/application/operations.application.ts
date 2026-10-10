import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { BillingApplicationService, BillingClaimsApplicationService } from '@care/billing';
import type { BenefitsApplicationService } from '@care/benefits';
import {
  CareDocumentationNotFoundError,
  CareDocumentationVisitRelationshipRequiredError,
  type CareDocumentationApplicationService,
} from '@care/care-documentation';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import type { OutboxWriter } from '@care/platform';
import {
  assertCan,
  AuthorizationDeniedError,
  can,
  type AuthorizationPrincipal,
  type Permission,
  type ResourceContext,
} from '@care/permissions';
import {
  VisitNotFoundError,
  VisitOutsideProviderContextError,
  localDateTimeToInstant,
  type SchedulingApplicationService,
} from '@care/scheduling';
import {
  EvidencePackageNotFoundError,
  ServiceEvidenceVisitRelationshipRequiredError,
  type ServiceEvidenceApplicationService,
} from '@care/service-evidence';
import { clientRecords } from '@care/clients';
import { employeeFacilityAssignments, employeeRecords } from '@care/employees';
import { facilities, organizationsTable } from '@care/organizations';
import { agreements } from '@care/service-agreements';
import { visits } from '@care/scheduling';
import { careDocuments } from '@care/care-documentation';
import { evidencePackages } from '@care/service-evidence';
import { invoices } from '@care/billing';
import { claims } from '@care/billing';
import { clientBenefitEntitlements } from '@care/benefits';
import { documentArtifacts } from '@care/documents';
import {
  exceptionInteractions,
  exceptionOccurrences,
  taskActivity,
  tasks,
} from '@module/operations/schema';
import {
  evidenceIssueCode,
  evidencePackageIssueCode,
  stableIssueId,
} from '@module/operations/domain/operations';

type AuditContext = { ip?: string; userAgent?: string };
type SourceType = NonNullable<(typeof tasks.$inferSelect)['sourceType']>;
type TaskStatus = (typeof tasks.$inferSelect)['status'];
type TaskPriority = (typeof tasks.$inferSelect)['priority'];
const projectionSourceAt = Symbol('projectionSourceAt');
type ProjectedOperationsWorkItem = OperationsWorkItem & {
  [projectionSourceAt]: Date | null;
};
type ReconciliationWindow = {
  from: Date | null;
  until: Date | null;
  sourceEntityKeys?: Set<string>;
};
type OnboardingReadinessCase = {
  id: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
  stage: string;
  createdAt: Date;
  nextFollowUpAt: Date | null;
  blockerCount: number;
};

const MAX_STALE_EXCEPTION_RECONCILIATIONS = 20;

export interface OperationsSourceServices {
  scheduling: Pick<SchedulingApplicationService, 'getWorklist' | 'getWorklistForVisit'>;
  documentation: Pick<CareDocumentationApplicationService, 'worklist' | 'getForVisit'>;
  evidence: Pick<ServiceEvidenceApplicationService, 'worklist' | 'getPackage'>;
  benefits: Pick<BenefitsApplicationService, 'getWorklist' | 'listUnallocatedServices'>;
  billing: Pick<BillingApplicationService, 'listInvoices' | 'receivables'>;
  claims: Pick<BillingClaimsApplicationService, 'listClaims' | 'readiness'>;
  onboarding?: {
    operationsReadinessWorklist(
      principal: AuthorizationPrincipal,
    ): Promise<{ items: OnboardingReadinessCase[]; complete: boolean }>;
    operationsIssueState(
      principal: AuthorizationPrincipal,
      caseId: string,
    ): Promise<{ readinessBlocked: boolean; followUpOverdue: boolean }>;
  };
}

export interface OperationsSourceReference {
  type: SourceType;
  id: string;
}

export interface OperationsTaskInput {
  organizationId?: string;
  facilityId?: string | null;
  clientId?: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedEmployeeId?: string | null;
  dueAt?: Date | null;
  source?: OperationsSourceReference | null;
}

export interface OperationsTaskPatch {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedEmployeeId?: string | null;
  dueAt?: Date | null;
}

export interface OperationsQuery {
  category?: OperationsWorkItem['category'];
  status?: OperationsWorkItem['status'];
  severity?: OperationsWorkItem['severity'];
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  assignedEmployeeId?: string;
  due?: 'overdue' | 'today' | 'upcoming';
  search?: string;
  sort?: 'relevance' | 'due';
  page?: number;
  pageSize?: number;
}

export interface OperationsWorkItem {
  id: string;
  kind: 'exception';
  category:
    | 'scheduling'
    | 'visits'
    | 'documentation'
    | 'benefits'
    | 'billing'
    | 'claims'
    | 'onboarding';
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: string;
  issueCode: string;
  titleCode: string;
  descriptionCode: string;
  categoryLabelCode: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'snoozed';
  organizationId: string | null;
  facilityId: string | null;
  clientId: string | null;
  clientName: string | null;
  dueAt: string | null;
  firstDetectedAt: string;
  lastObservedAt: string;
  interaction: {
    action: 'acknowledged' | 'snoozed';
    occurredAt: string;
    snoozedUntil: string | null;
    reason: string | null;
  } | null;
}

export class OperationsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly sources: OperationsSourceServices,
  ) {}

  async dashboard(
    principal: AuthorizationPrincipal,
    query: Pick<OperationsQuery, 'organizationId' | 'facilityId'> = {},
  ) {
    const worklist = await this.listWorkItems(principal, { ...query, page: 1, pageSize: 1000 });
    const tasksSummary = await this.taskSummary(principal, query);
    const categoryCounts = Object.fromEntries(
      (
        [
          'scheduling',
          'visits',
          'documentation',
          'benefits',
          'billing',
          'claims',
          'onboarding',
        ] as const
      ).map((category) => [
        category,
        worklist.items.filter((item) => item.category === category).length,
      ]),
    );
    const severityCounts = Object.fromEntries(
      (['info', 'warning', 'critical'] as const).map((severity) => [
        severity,
        worklist.items.filter((item) => item.severity === severity).length,
      ]),
    );
    return {
      generatedAt: new Date().toISOString(),
      exceptionCount: worklist.items.filter(
        (item) => item.status === 'open' || item.severity === 'critical',
      ).length,
      categoryCounts,
      severityCounts,
      worklistTruncated: worklist.truncated || worklist.total > worklist.items.length,
      tasks: tasksSummary,
      highPriorityExceptions: worklist.items
        .filter((item) => item.severity === 'critical' || item.severity === 'warning')
        .slice(0, 10),
    };
  }

  async listWorkItems(principal: AuthorizationPrincipal, query: OperationsQuery = {}) {
    this.requireAnyGrant(principal, 'operations.read');
    const observedAt = new Date();
    const now = observedAt;
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const documentationFrom = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000 + 1);
    const sourceUntil = new Date(now.getTime() + 1);
    const canRead = (permission: Permission) => hasGrant(principal, permission);
    const [
      schedule,
      documentation,
      evidence,
      benefitData,
      invoicesForDocuments,
      receivables,
      claimsPage,
      onboardingReadiness,
    ] = await Promise.all([
      canRead('schedule.read')
        ? this.sources.scheduling.getWorklist(principal, {
            from: now,
            until,
            page: 1,
            pageSize: 100,
          })
        : null,
      canRead('care_documentation.review')
        ? this.sources.documentation.worklist(principal, {
            from: documentationFrom,
            until: sourceUntil,
            incomplete: true,
            page: 1,
            pageSize: 100,
          })
        : null,
      canRead('service_evidence.read')
        ? this.sources.evidence.worklist(principal, {
            from,
            until: sourceUntil,
            page: 1,
            pageSize: 100,
          })
        : null,
      canRead('benefits.review') ? this.sources.benefits.getWorklist(principal, 1, 100) : null,
      canRead('billing.read')
        ? this.sources.billing.listInvoices(principal, { page: 1, pageSize: 100 })
        : null,
      canRead('billing.payments.read')
        ? this.sources.billing.receivables(principal, { page: 1, pageSize: 100 })
        : null,
      canRead('claims.read')
        ? this.sources.claims.listClaims(principal, { page: 1, pageSize: 100 })
        : null,
      canRead('onboarding.read') && this.sources.onboarding
        ? this.sources.onboarding.operationsReadinessWorklist(principal)
        : null,
    ]);
    const completeDomains = new Map<string, ReconciliationWindow>();
    if (schedule && schedule.total <= schedule.items.length) {
      completeDomains.set('scheduling', {
        from: now,
        until,
        sourceEntityKeys: new Set(
          schedule.items.map((row) => sourceEntityKey('visit', row.visit.id)),
        ),
      });
    }
    if (documentation && documentation.total <= documentation.items.length) {
      completeDomains.set('care_documentation', { from: documentationFrom, until: sourceUntil });
    }
    if (evidence && evidence.total <= evidence.items.length) {
      completeDomains.set('service_evidence', {
        from,
        until: sourceUntil,
        sourceEntityKeys: new Set(
          evidence.items.map((row) =>
            sourceEntityKey(
              row.evidencePackageId ? 'evidence_package' : 'documentation',
              row.evidencePackageId ?? row.documentationId,
            ),
          ),
        ),
      });
    }
    if (
      benefitData &&
      benefitData.clients.total <= benefitData.clients.items.length &&
      benefitData.unallocatedServices.items.length < 100
    ) {
      completeDomains.set('benefits', { from: null, until: null });
    }
    if (
      invoicesForDocuments &&
      receivables &&
      invoicesForDocuments.length < 100 &&
      receivables.length < 100
    ) {
      completeDomains.set('billing', { from: null, until: null });
    }
    if (claimsPage && !claimsPage.hasMore) {
      completeDomains.set('claims', { from: null, until: null });
    }
    if (onboardingReadiness?.complete) {
      completeDomains.set('onboarding', { from: null, until: null });
    }

    const evidenceResources = evidence
      ? await this.clientResources(
          principal.tenantId,
          evidence.items.map((row) => row.clientId),
        )
      : new Map<string, { organizationId: string | null; facilityId: string | null }>();
    const organizationIds = [
      ...(schedule?.items.map((row) => row.visit.organizationId) ?? []),
      ...(documentation?.items.map((row) => row.organizationId) ?? []),
      ...[...evidenceResources.values()].flatMap((resource) =>
        resource.organizationId ? [resource.organizationId] : [],
      ),
      ...(benefitData?.clients.items.map((row) => row.organizationId) ?? []),
      ...(benefitData?.unallocatedServices.items.map((row) => row.organizationId) ?? []),
      ...(invoicesForDocuments?.map((row) => row.organizationId) ?? []),
      ...(receivables?.map((row) => row.organizationId) ?? []),
      ...(claimsPage?.items.map((row) => row.organizationId) ?? []),
    ];
    const timezoneByOrganization = await this.organizationTimezones(
      principal.tenantId,
      organizationIds.filter((id): id is string => id !== null),
    );

    const items: ProjectedOperationsWorkItem[] = [];
    let truncated = false;
    if (schedule) {
      truncated ||= schedule.total > schedule.items.length;
      for (const row of schedule.items) {
        const visit = row.visit;
        for (const conflict of row.conflicts) {
          items.push(
            this.workItem({
              sourceDomain: 'scheduling',
              entityType: 'visit',
              entityId: visit.id,
              issueCode: conflict.code,
              category: 'scheduling',
              severity: conflict.severity === 'blocking' ? 'critical' : 'warning',
              organizationId: visit.organizationId,
              facilityId: visit.facilityId,
              clientId: visit.clientId,
              clientName: visit.clientDisplayName,
              dueAt: visit.plannedStart.toISOString(),
              sourceAt: visit.plannedStart,
              descriptionCode: `operations.issues.scheduling.${conflict.code}`,
            }),
          );
        }
      }
    }
    if (documentation) {
      truncated ||= documentation.total > documentation.items.length;
      for (const row of documentation.items) {
        for (const missing of row.missing) {
          const issueCode = `documentation_${missing.code.toLowerCase()}`;
          items.push(
            this.workItem({
              sourceDomain: 'care_documentation',
              entityType: 'visit',
              entityId: row.visitId,
              issueCode,
              category: 'documentation',
              severity: 'warning',
              organizationId: row.organizationId,
              facilityId: row.facilityId,
              clientId: row.clientId,
              clientName: row.clientDisplayName,
              dueAt: null,
              sourceAt: new Date(row.plannedStart),
              descriptionCode: `operations.issues.documentation.${missing.code.toLowerCase()}`,
            }),
          );
        }
      }
    }
    if (evidence) {
      const acknowledgementRequirements = new Map(
        await Promise.all(
          evidence.items
            .filter((row) => row.status === 'awaiting_acknowledgement' && row.evidencePackageId)
            .map(
              async (row) =>
                [
                  row.evidencePackageId!,
                  (await this.sources.evidence.getPackage(principal, row.evidencePackageId!))
                    .acknowledgementRequired,
                ] as const,
            ),
        ),
      );
      truncated ||= evidence.total > evidence.items.length;
      for (const row of evidence.items) {
        const issueCode = evidenceIssueCode(
          row,
          acknowledgementRequirements.get(row.evidencePackageId ?? '') ?? false,
        );
        if (!issueCode) continue;
        const resource = evidenceResources.get(row.clientId);
        items.push(
          this.workItem({
            sourceDomain: 'service_evidence',
            entityType: row.evidencePackageId ? 'evidence_package' : 'documentation',
            entityId: row.evidencePackageId ?? row.documentationId,
            issueCode,
            category: 'documentation',
            severity:
              row.status === 'declined' || row.status === 'revoked' ? 'critical' : 'warning',
            organizationId: resource?.organizationId ?? null,
            facilityId: resource?.facilityId ?? null,
            clientId: row.clientId,
            clientName: row.clientName,
            dueAt: null,
            sourceAt: new Date(row.plannedStart),
            descriptionCode: `operations.issues.evidence.${issueCode}`,
          }),
        );
      }
    }
    if (benefitData) {
      const clientRows = benefitData.clients.items;
      truncated ||= benefitData.clients.total > clientRows.length;
      for (const row of clientRows) {
        const problems: Array<{ code: string; severity: OperationsWorkItem['severity'] }> = [];
        if (row.missingEntitlement)
          problems.push({ code: 'missing_entitlement', severity: 'warning' });
        if (row.unverifiedOpeningBalance)
          problems.push({ code: 'unverified_balance', severity: 'warning' });
        if (row.expiringCarryoverCents > 0)
          problems.push({ code: 'carryover_expiring', severity: 'warning' });
        for (const problem of problems) {
          items.push(
            this.workItem({
              sourceDomain: 'benefits',
              entityType: 'client',
              entityId: row.clientId,
              issueCode: problem.code,
              category: 'benefits',
              severity: problem.severity,
              organizationId: row.organizationId,
              facilityId: row.facilityId,
              clientId: row.clientId,
              clientName: row.clientName,
              dueAt: null,
              descriptionCode: `operations.issues.benefits.${problem.code}`,
            }),
          );
        }
      }
      for (const row of benefitData.unallocatedServices.items) {
        items.push(
          this.workItem({
            sourceDomain: 'benefits',
            entityType: 'performed_service',
            entityId: row.performedServiceId,
            issueCode: 'service_unallocated',
            category: 'benefits',
            severity: 'warning',
            organizationId: row.organizationId,
            facilityId: row.facilityId,
            clientId: row.clientId,
            clientName: row.clientName,
            dueAt: null,
            descriptionCode: 'operations.issues.benefits.service_unallocated',
          }),
        );
      }
      truncated ||= benefitData.unallocatedServices.items.length === 100;
    }
    if (invoicesForDocuments) {
      truncated ||= invoicesForDocuments.length === 100;
      for (const invoice of invoicesForDocuments) {
        if (invoice.pdfStatus !== 'failed') continue;
        items.push(
          this.workItem({
            sourceDomain: 'billing',
            entityType: 'invoice',
            entityId: invoice.id,
            issueCode: 'invoice_document_failed',
            category: 'billing',
            severity: 'critical',
            organizationId: invoice.organizationId,
            facilityId: invoice.facilityId,
            clientId: invoice.clientId,
            clientName: invoice.clientName,
            dueAt: null,
            descriptionCode: 'operations.issues.billing.invoice_document_failed',
          }),
        );
      }
    }
    if (receivables) {
      truncated ||= receivables.length === 100;
      for (const invoice of receivables) {
        if (!invoice.dueDate || invoice.dueDate >= now.toISOString().slice(0, 10)) continue;
        items.push(
          this.workItem({
            sourceDomain: 'billing',
            entityType: 'invoice',
            entityId: invoice.id,
            issueCode: 'receivable_overdue',
            category: 'billing',
            severity: 'critical',
            organizationId: invoice.organizationId,
            facilityId: invoice.facilityId,
            clientId: invoice.clientId,
            clientName: invoice.clientName,
            dueAt: endOfLocalDay(
              invoice.dueDate,
              timezoneByOrganization.get(invoice.organizationId) ?? 'Europe/Berlin',
            ),
            descriptionCode: 'operations.issues.billing.receivable_overdue',
          }),
        );
      }
    }
    if (claimsPage) {
      truncated ||= claimsPage.hasMore;
      const claimReadiness = new Map(
        await Promise.all(
          claimsPage.items
            .filter((claim) => claim.status === 'draft')
            .map(
              async (claim) =>
                [claim.id, await this.sources.claims.readiness(principal, claim.id)] as const,
            ),
        ),
      );
      for (const claim of claimsPage.items) {
        let issueCode: string | null = null;
        if (claim.status === 'rejected') issueCode = 'claim_rejected';
        else if (claim.status === 'clarification_required') issueCode = 'claim_clarification';
        else if (claim.status === 'ready') issueCode = 'claim_ready_to_submit';
        else if (claim.status === 'draft') {
          const readiness = claimReadiness.get(claim.id);
          if (readiness?.blockers.length) issueCode = 'claim_readiness_blocked';
        } else if (claim.status === 'accepted' || claim.status === 'partially_accepted') {
          const accepted = claim.acceptedCents ?? claim.amountCents;
          if (claim.paidCents < accepted) issueCode = 'claim_payment_outstanding';
        }
        if (!issueCode) continue;
        items.push(
          this.workItem({
            sourceDomain: 'claims',
            entityType: 'claim',
            entityId: claim.id,
            issueCode,
            category: 'claims',
            severity: issueCode === 'claim_rejected' ? 'critical' : 'warning',
            organizationId: claim.organizationId,
            facilityId: claim.facilityId,
            clientId: claim.clientId,
            clientName: claim.clientName,
            dueAt: null,
            descriptionCode: `operations.issues.claims.${issueCode}`,
          }),
        );
      }
    }
    if (onboardingReadiness) {
      truncated ||= !onboardingReadiness.complete;
      for (const admission of onboardingReadiness.items) {
        const isOverdue = Boolean(
          admission.nextFollowUpAt && admission.nextFollowUpAt < observedAt,
        );
        if (admission.blockerCount > 0) {
          items.push(
            this.workItem({
              sourceDomain: 'onboarding',
              entityType: 'admission_case',
              entityId: admission.id,
              issueCode: 'admission_readiness_blocked',
              category: 'onboarding',
              severity: isOverdue ? 'critical' : 'warning',
              organizationId: admission.organizationId,
              facilityId: admission.facilityId,
              clientId: admission.clientId,
              clientName: `${admission.firstName} ${admission.lastName}`,
              dueAt: admission.nextFollowUpAt?.toISOString() ?? null,
              sourceAt: admission.createdAt,
              descriptionCode: 'operations.issues.onboarding.readiness_blocked',
            }),
          );
        }
        if (isOverdue) {
          items.push(
            this.workItem({
              sourceDomain: 'onboarding',
              entityType: 'admission_case',
              entityId: admission.id,
              issueCode: 'admission_follow_up_overdue',
              category: 'onboarding',
              severity: 'critical',
              organizationId: admission.organizationId,
              facilityId: admission.facilityId,
              clientId: admission.clientId,
              clientName: `${admission.firstName} ${admission.lastName}`,
              dueAt: admission.nextFollowUpAt!.toISOString(),
              sourceAt: admission.nextFollowUpAt,
              descriptionCode: 'operations.issues.onboarding.follow_up_overdue',
            }),
          );
        }
      }
    }

    let visible = deduplicateWorkItems(items).filter((item) =>
      can(principal, {
        action: 'operations.read',
        resource: workItemResource(principal, item),
      }),
    );
    await this.syncExceptionOccurrences(principal, visible, completeDomains, observedAt);
    await this.reconcileStaleExceptionOccurrences(principal, visible, observedAt);
    visible = await this.attachInteractions(principal, visible);
    visible = visible.filter((item) => {
      if (query.category && item.category !== query.category) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.severity && item.severity !== query.severity) return false;
      if (query.organizationId && item.organizationId !== query.organizationId) return false;
      if (query.facilityId && item.facilityId !== query.facilityId) return false;
      if (query.clientId && item.clientId !== query.clientId) return false;
      if (
        query.due &&
        !matchesDueFilter(
          item.dueAt,
          query.due,
          now,
          timezoneByOrganization.get(item.organizationId ?? '') ?? 'Europe/Berlin',
        )
      )
        return false;
      if (query.search) {
        const term = query.search.trim().toLowerCase();
        if (
          !`${item.issueCode} ${item.clientName ?? ''} ${item.sourceEntityId}`
            .toLowerCase()
            .includes(term)
        ) {
          return false;
        }
      }
      return true;
    });
    visible.sort((left, right) => {
      const byDue =
        (left.dueAt ?? '9999').localeCompare(right.dueAt ?? '9999') ||
        left.id.localeCompare(right.id);
      if (query.sort === 'due') return byDue;
      const severity = severityWeight(right.severity) - severityWeight(left.severity);
      return severity || byDue;
    });
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 50, 1, 1000);
    return {
      items: visible.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: visible.length,
      truncated,
    };
  }

  async exceptionHistory(
    principal: AuthorizationPrincipal,
    issueId: string,
    query: { page?: number; pageSize?: number } = {},
  ) {
    this.requireAnyGrant(principal, 'operations.read');
    if (!/^[a-f0-9]{64}$/.test(issueId)) throw new OperationsWorkItemNotFoundError();
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 50, 1, 100);

    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const allOccurrences = await transaction
        .select()
        .from(exceptionOccurrences)
        .where(
          and(
            eq(exceptionOccurrences.tenantId, principal.tenantId),
            eq(exceptionOccurrences.issueKey, issueId),
          ),
        )
        .orderBy(desc(exceptionOccurrences.firstDetectedAt), desc(exceptionOccurrences.id));
      const allowedOccurrences = allOccurrences.filter((occurrence) => {
        const permission = exceptionReadPermission(occurrence.sourceDomain, occurrence.issueCode);
        if (!permission) return false;
        const resource: ResourceContext = {
          tenantId: occurrence.tenantId,
          ...(occurrence.organizationId ? { organizationId: occurrence.organizationId } : {}),
          ...(occurrence.facilityId ? { facilityId: occurrence.facilityId } : {}),
          ...(occurrence.clientId ? { clientId: occurrence.clientId } : {}),
        };
        return (
          can(principal, { action: 'operations.read', resource }) &&
          can(principal, { action: permission, resource }) &&
          (!occurrence.clientId || can(principal, { action: 'client.read', resource }))
        );
      });
      if (!allowedOccurrences.length) throw new OperationsWorkItemNotFoundError();

      const occurrenceIds = allowedOccurrences.map((occurrence) => occurrence.id);
      const interactionLinks = [inArray(exceptionInteractions.occurrenceId, occurrenceIds)];
      if (allowedOccurrences.length === allOccurrences.length) {
        interactionLinks.push(isNull(exceptionInteractions.occurrenceId));
      }
      const interactionScope = and(
        eq(exceptionInteractions.tenantId, principal.tenantId),
        eq(exceptionInteractions.issueKey, issueId),
        or(...interactionLinks)!,
      );
      const [interactionCount] = await transaction
        .select({ value: count() })
        .from(exceptionInteractions)
        .where(interactionScope);
      const interactions = await transaction
        .select({
          id: exceptionInteractions.id,
          occurrenceId: exceptionInteractions.occurrenceId,
          action: exceptionInteractions.action,
          previousState: exceptionInteractions.previousState,
          snoozedUntil: exceptionInteractions.snoozedUntil,
          reason: exceptionInteractions.reason,
          actorUserId: exceptionInteractions.actorUserId,
          occurredAt: exceptionInteractions.occurredAt,
        })
        .from(exceptionInteractions)
        .where(interactionScope)
        .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        issueId,
        page,
        pageSize,
        totalOccurrences: allowedOccurrences.length,
        totalInteractions: interactionCount?.value ?? 0,
        occurrences: allowedOccurrences
          .slice((page - 1) * pageSize, page * pageSize)
          .map((row) => ({
            id: row.id,
            sourceDomain: row.sourceDomain,
            sourceEntityType: row.sourceEntityType,
            sourceEntityId: row.sourceEntityId,
            issueCode: row.issueCode,
            category: row.category,
            severity: row.severity,
            organizationId: row.organizationId,
            facilityId: row.facilityId,
            clientId: row.clientId,
            firstDetectedAt: row.firstDetectedAt.toISOString(),
            lastObservedAt: row.lastObservedAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
          })),
        interactions: interactions.map((row) => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
        })),
      };
    });
  }

  async createTask(
    principal: AuthorizationPrincipal,
    input: OperationsTaskInput,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!validTaskInput(input)) throw new InvalidOperationsInputError();
    const sourceContext = input.source ? await this.validateSource(principal, input.source) : null;
    const referencedClientContext = input.clientId
      ? await this.clientContext(principal, input.clientId)
      : sourceContext?.clientId
        ? await this.clientContext(principal, sourceContext.clientId)
        : null;
    const organizationId =
      input.organizationId ??
      sourceContext?.organizationId ??
      referencedClientContext?.organizationId;
    if (!organizationId) throw new InvalidOperationsInputError();
    if (
      (sourceContext && sourceContext.organizationId !== organizationId) ||
      (referencedClientContext && referencedClientContext.organizationId !== organizationId)
    ) {
      throw new InvalidOperationsInputError();
    }
    const derivedFacilityId = sourceContext
      ? sourceContext.facilityId
      : (referencedClientContext?.facilityId ?? null);
    const facilityId = input.facilityId === undefined ? derivedFacilityId : input.facilityId;
    if (
      input.facilityId !== undefined &&
      ((sourceContext?.facilityId && sourceContext.facilityId !== input.facilityId) ||
        (!sourceContext &&
          referencedClientContext?.facilityId &&
          referencedClientContext.facilityId !== input.facilityId))
    ) {
      throw new InvalidOperationsInputError();
    }
    const clientId =
      input.clientId === undefined ? (sourceContext?.clientId ?? null) : input.clientId;
    if (
      sourceContext &&
      (sourceContext.facilityId !== facilityId ||
        (sourceContext.clientId && sourceContext.clientId !== clientId))
    ) {
      throw new InvalidOperationsInputError();
    }
    const resource = {
      tenantId: principal.tenantId,
      organizationId,
      ...(facilityId ? { facilityId } : {}),
      ...(clientId ? { clientId } : {}),
    };
    assertCan(principal, { action: 'operations.tasks.create', resource });
    await this.assertTaskScope(resource);
    if (input.assignedEmployeeId) {
      assertCan(principal, { action: 'operations.tasks.assign', resource });
    }

    const now = new Date();
    const id = uuidv7();
    const sourceColumns = sourceColumnsFor(input.source ?? null);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      if (input.assignedEmployeeId) {
        await this.validateAssignee(
          transaction,
          principal.tenantId,
          input.assignedEmployeeId,
          organizationId,
          facilityId,
        );
      }
      const [task] = await transaction
        .insert(tasks)
        .values({
          id,
          tenantId: principal.tenantId,
          organizationId,
          facilityId,
          clientId,
          title: input.title.trim(),
          description: normalizeOptional(input.description),
          status: 'open',
          priority: input.priority ?? 'normal',
          assignedEmployeeId: input.assignedEmployeeId ?? null,
          createdByUserId: principal.userId,
          completedByUserId: null,
          dueAt: input.dueAt ?? null,
          completedAt: null,
          sourceType: input.source?.type ?? null,
          ...sourceColumns,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.addActivity(transaction, principal, task!, 'created', {
        status: 'open',
        priority: task!.priority,
      });
      if (task!.assignedEmployeeId) {
        await this.addActivity(transaction, principal, task!, 'assigned', {
          employeeId: task!.assignedEmployeeId,
        });
      }
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type: 'operations.task_created',
        action: 'operations.task_created',
        aggregateId: id,
        payload: { taskId: id, organizationId, clientId },
        metadata: { taskId: id, organizationId, clientId },
      });
      if (task!.assignedEmployeeId) {
        await this.recordStateChange(transaction, principal, request, auditContext, {
          type: 'operations.task_assigned',
          action: 'operations.task_assigned',
          aggregateId: id,
          payload: { taskId: id, employeeId: task!.assignedEmployeeId },
          metadata: { taskId: id },
        });
      }
      return this.taskView(principal, task!);
    });
  }

  async listTasks(principal: AuthorizationPrincipal, query: OperationsTaskListQuery = {}) {
    this.requireAnyGrant(principal, 'operations.read');
    const page = bounded(query.page, 1, 1, 100_000);
    const pageSize = bounded(query.pageSize, 25, 1, 100);
    if (query.assignedEmployeeId) this.requireAnyGrant(principal, 'operations.tasks.assign');
    const scopeConditions = this.taskScopeConditions(principal);
    if (scopeConditions && !scopeConditions.length) return { items: [], page, pageSize, total: 0 };
    const conditions: SQL[] = [eq(tasks.tenantId, principal.tenantId), ...(scopeConditions ?? [])];
    if (query.organizationId) conditions.push(eq(tasks.organizationId, query.organizationId));
    if (query.facilityId) conditions.push(eq(tasks.facilityId, query.facilityId));
    if (query.clientId) conditions.push(eq(tasks.clientId, query.clientId));
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.priority) conditions.push(eq(tasks.priority, query.priority));
    if (query.assignedEmployeeId)
      conditions.push(eq(tasks.assignedEmployeeId, query.assignedEmployeeId));
    if (query.assignedToMe) {
      const employeeId = await this.employeeForUser(principal.tenantId, principal.userId);
      if (!employeeId) return { items: [], page, pageSize, total: 0 };
      conditions.push(eq(tasks.assignedEmployeeId, employeeId));
    }
    if (query.search?.trim()) {
      const pattern = `%${escapeLike(query.search.trim())}%`;
      conditions.push(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!);
    }
    const now = new Date();
    const { dueDate: localDueDate, today: localToday } = taskDueLocalDates();
    if (query.due === 'overdue') {
      conditions.push(lt(tasks.dueAt, now), inArray(tasks.status, ['open', 'in_progress']));
    } else if (query.due === 'today') {
      conditions.push(sql`${tasks.dueAt} IS NOT NULL AND ${localDueDate} = ${localToday}`);
      conditions.push(inArray(tasks.status, ['open', 'in_progress']));
    } else if (query.due === 'upcoming') {
      conditions.push(sql`${tasks.dueAt} IS NOT NULL AND ${localDueDate} > ${localToday}`);
      conditions.push(inArray(tasks.status, ['open', 'in_progress']));
    }
    if (query.order === 'created') {
      // Listing is stable by newest creation when explicitly requested.
    }
    const where = and(...conditions);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [totalRow] = await transaction.select({ count: count() }).from(tasks).where(where);
      const rows = await transaction
        .select()
        .from(tasks)
        .where(where)
        .orderBy(
          query.order === 'created' ? desc(tasks.createdAt) : sql`${tasks.dueAt} asc nulls last`,
          desc(tasks.id),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const items = [];
      for (const row of rows) {
        if (!can(principal, { action: 'operations.read', resource: taskResource(row) })) continue;
        items.push(this.taskView(principal, row));
      }
      return { items, page, pageSize, total: totalRow?.count ?? 0 };
    });
  }

  async getTask(principal: AuthorizationPrincipal, taskId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.read');
      return this.taskView(principal, task);
    });
  }

  async taskActivityList(principal: AuthorizationPrincipal, taskId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.read');
      const rows = await transaction
        .select()
        .from(taskActivity)
        .where(and(eq(taskActivity.tenantId, principal.tenantId), eq(taskActivity.taskId, task.id)))
        .orderBy(asc(taskActivity.occurredAt), asc(taskActivity.id))
        .limit(200);
      return rows;
    });
  }

  async patchTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    input: OperationsTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.updateTask(principal, taskId, input, request, auditContext);
  }

  async startTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'in_progress',
      request,
      auditContext,
    );
  }

  async completeTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'completed',
      request,
      auditContext,
    );
  }

  async reopenTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(principal, taskId, expectedVersion, 'open', request, auditContext);
  }

  async cancelTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    return this.transitionTask(
      principal,
      taskId,
      expectedVersion,
      'cancelled',
      request,
      auditContext,
    );
  }

  async addComment(
    principal: AuthorizationPrincipal,
    taskId: string,
    comment: string,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const normalized = comment.trim();
    if (normalized.length < 1 || normalized.length > 4000) throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      const now = new Date();
      await transaction.insert(taskActivity).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        taskId: task.id,
        actorUserId: principal.userId,
        kind: 'comment',
        details: {},
        comment: normalized,
        occurredAt: now,
      });
      await this.recordAudit(transaction, principal, request, auditContext, {
        action: 'operations.task_comment_added',
        resourceId: task.id,
        metadata: { taskId: task.id },
      });
      return { added: true, occurredAt: now.toISOString() };
    });
  }

  async acknowledgeException(
    principal: AuthorizationPrincipal,
    id: string,
    reason: string | undefined,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const item = await this.findCurrentWorkItem(principal, id);
    assertCan(principal, {
      action: 'operations.exceptions.manage',
      resource: workItemResource(principal, item),
    });
    if (reason !== undefined && (reason.trim().length < 1 || reason.trim().length > 500))
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const now = new Date();
      const occurrence = await this.activeExceptionOccurrence(
        transaction,
        principal.tenantId,
        item.id,
      );
      if (!occurrence) throw new OperationsWorkItemNotFoundError();
      const previous = await this.latestExceptionInteraction(
        transaction,
        principal.tenantId,
        occurrence.id,
      );
      await transaction.insert(exceptionInteractions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        issueKey: item.id,
        occurrenceId: occurrence.id,
        action: 'acknowledged',
        previousState: exceptionState(previous, now),
        snoozedUntil: null,
        reason: reason?.trim() || null,
        actorUserId: principal.userId,
        occurredAt: now,
      });
      await this.recordExceptionChange(
        transaction,
        principal,
        request,
        auditContext,
        item,
        occurrence.id,
        'acknowledged',
      );
      return { id: item.id, status: 'acknowledged' as const, occurredAt: now.toISOString() };
    });
  }

  async snoozeException(
    principal: AuthorizationPrincipal,
    id: string,
    snoozedUntil: Date,
    reason: string | undefined,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    const item = await this.findCurrentWorkItem(principal, id);
    if (item.severity === 'critical') throw new InvalidOperationsInputError();
    assertCan(principal, {
      action: 'operations.exceptions.manage',
      resource: workItemResource(principal, item),
    });
    const now = new Date();
    if (
      !Number.isFinite(snoozedUntil.getTime()) ||
      snoozedUntil <= now ||
      snoozedUntil.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1000
    ) {
      throw new InvalidOperationsInputError();
    }
    if (reason !== undefined && (reason.trim().length < 1 || reason.trim().length > 500))
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const occurrence = await this.activeExceptionOccurrence(
        transaction,
        principal.tenantId,
        item.id,
      );
      if (!occurrence) throw new OperationsWorkItemNotFoundError();
      const previous = await this.latestExceptionInteraction(
        transaction,
        principal.tenantId,
        occurrence.id,
      );
      await transaction.insert(exceptionInteractions).values({
        id: uuidv7(),
        tenantId: principal.tenantId,
        issueKey: item.id,
        occurrenceId: occurrence.id,
        action: 'snoozed',
        previousState: exceptionState(previous, now),
        snoozedUntil,
        reason: reason?.trim() || null,
        actorUserId: principal.userId,
        occurredAt: now,
      });
      await this.recordExceptionChange(
        transaction,
        principal,
        request,
        auditContext,
        item,
        occurrence.id,
        'snoozed',
        snoozedUntil,
      );
      return { id: item.id, status: 'snoozed' as const, snoozedUntil: snoozedUntil.toISOString() };
    });
  }

  private async updateTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    input: OperationsTaskPatch,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !validPatch(input)
    )
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      if (task.version !== input.expectedVersion) throw new OperationsTaskVersionConflictError();
      if (task.status === 'completed' || task.status === 'cancelled')
        throw new OperationsTaskStateError();
      const changedFields: string[] = [];
      const values: Partial<typeof tasks.$inferInsert> = {
        version: task.version + 1,
        updatedAt: new Date(),
      };
      if (input.title !== undefined && input.title.trim() !== task.title) {
        values.title = input.title.trim();
        changedFields.push('title');
      }
      if (
        input.description !== undefined &&
        normalizeOptional(input.description) !== task.description
      ) {
        values.description = normalizeOptional(input.description);
        changedFields.push('description');
      }
      if (input.priority !== undefined && input.priority !== task.priority) {
        values.priority = input.priority;
        changedFields.push('priority');
      }
      if (input.dueAt !== undefined && input.dueAt?.getTime() !== task.dueAt?.getTime()) {
        values.dueAt = input.dueAt;
        changedFields.push('due_date');
      }
      if (
        input.assignedEmployeeId !== undefined &&
        input.assignedEmployeeId !== task.assignedEmployeeId
      ) {
        assertCan(principal, { action: 'operations.tasks.assign', resource: taskResource(task) });
        if (input.assignedEmployeeId)
          await this.validateAssignee(
            transaction,
            principal.tenantId,
            input.assignedEmployeeId,
            task.organizationId,
            task.facilityId,
          );
        values.assignedEmployeeId = input.assignedEmployeeId;
        changedFields.push('assigned_employee');
      }
      if (!changedFields.length) return this.taskView(principal, task);
      const [updated] = await transaction
        .update(tasks)
        .set(values)
        .where(
          and(
            eq(tasks.tenantId, principal.tenantId),
            eq(tasks.id, task.id),
            eq(tasks.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OperationsTaskVersionConflictError();
      await this.addActivity(transaction, principal, updated, 'edited', { changedFields });
      if (changedFields.includes('assigned_employee')) {
        await this.addActivity(transaction, principal, updated, 'assigned', {
          employeeId: updated.assignedEmployeeId,
        });
      }
      if (changedFields.includes('priority')) {
        await this.addActivity(transaction, principal, updated, 'priority_changed', {
          priority: updated.priority,
        });
      }
      if (changedFields.includes('due_date')) {
        await this.addActivity(transaction, principal, updated, 'due_date_changed', {
          dueAt: updated.dueAt?.toISOString() ?? null,
        });
      }
      const eventType = changedFields.includes('assigned_employee')
        ? 'operations.task_assigned'
        : 'operations.task_updated';
      const payload =
        eventType === 'operations.task_assigned'
          ? { taskId: task.id, employeeId: updated.assignedEmployeeId }
          : { taskId: task.id, changedFields };
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type: eventType,
        action: eventType,
        aggregateId: task.id,
        payload,
        metadata: { taskId: task.id, changedFields },
      });
      return this.taskView(principal, updated);
    });
  }

  private async transitionTask(
    principal: AuthorizationPrincipal,
    taskId: string,
    expectedVersion: number,
    status: TaskStatus,
    request: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new InvalidOperationsInputError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const task = await this.readTask(transaction, principal, taskId, 'operations.tasks.manage');
      if (task.version !== expectedVersion) throw new OperationsTaskVersionConflictError();
      const allowed =
        status === 'in_progress'
          ? task.status === 'open'
          : status === 'completed'
            ? task.status === 'open' || task.status === 'in_progress'
            : status === 'open'
              ? task.status === 'completed'
              : task.status === 'open' || task.status === 'in_progress';
      if (!allowed) throw new OperationsTaskStateError();
      const now = new Date();
      const [updated] = await transaction
        .update(tasks)
        .set({
          status,
          completedAt: status === 'completed' ? now : null,
          completedByUserId: status === 'completed' ? principal.userId : null,
          version: task.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(tasks.tenantId, principal.tenantId),
            eq(tasks.id, task.id),
            eq(tasks.version, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new OperationsTaskVersionConflictError();
      await this.addActivity(transaction, principal, updated, 'status_changed', {
        from: task.status,
        to: status,
      });
      const type =
        status === 'completed'
          ? 'operations.task_completed'
          : status === 'cancelled'
            ? 'operations.task_cancelled'
            : status === 'open'
              ? 'operations.task_reopened'
              : 'operations.task_updated';
      const action = type;
      const payload =
        type === 'operations.task_updated'
          ? { taskId: task.id, changedFields: ['status'] }
          : { taskId: task.id };
      await this.recordStateChange(transaction, principal, request, auditContext, {
        type,
        action,
        aggregateId: task.id,
        payload,
        metadata: { taskId: task.id, from: task.status, to: status },
      });
      return this.taskView(principal, updated);
    });
  }

  private async taskSummary(
    principal: AuthorizationPrincipal,
    query: Pick<OperationsQuery, 'organizationId' | 'facilityId'>,
  ) {
    const scopeConditions = this.taskScopeConditions(principal);
    if (scopeConditions && !scopeConditions.length)
      return { assignedToMe: 0, dueToday: 0, overdue: 0, urgent: 0 };
    const conditions: SQL[] = [
      eq(tasks.tenantId, principal.tenantId),
      ...(scopeConditions ?? []),
      inArray(tasks.status, ['open', 'in_progress']),
    ];
    if (query.organizationId) conditions.push(eq(tasks.organizationId, query.organizationId));
    if (query.facilityId) conditions.push(eq(tasks.facilityId, query.facilityId));
    const employeeId = await this.employeeForUser(principal.tenantId, principal.userId);
    if (!employeeId) return { assignedToMe: 0, dueToday: 0, overdue: 0, urgent: 0 };
    conditions.push(eq(tasks.assignedEmployeeId, employeeId));
    const { dueDate: localDueDate, today: localToday } = taskDueLocalDates();
    const where = and(...conditions);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [summary] = await transaction
        .select({
          assignedToMe: count(),
          dueToday: sql<number>`count(*) filter (where ${tasks.dueAt} IS NOT NULL AND ${localDueDate} = ${localToday})`,
          overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now())`,
          urgent: sql<number>`count(*) filter (where ${tasks.priority} = 'urgent')`,
        })
        .from(tasks)
        .where(where);
      return {
        assignedToMe: Number(summary?.assignedToMe ?? 0),
        dueToday: Number(summary?.dueToday ?? 0),
        overdue: Number(summary?.overdue ?? 0),
        urgent: Number(summary?.urgent ?? 0),
      };
    });
  }

  private taskView(principal: AuthorizationPrincipal, task: typeof tasks.$inferSelect) {
    let source: OperationsSourceReference | null = null;
    const sourceId = sourceIdFromRow(task);
    if (task.sourceType && sourceId) {
      const action = sourcePermission(task.sourceType);
      if (can(principal, { action, resource: taskResource(task) }))
        source = { type: task.sourceType, id: sourceId };
    }
    return {
      id: task.id,
      organizationId: task.organizationId,
      facilityId: task.facilityId,
      clientId: task.clientId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignedEmployeeId: task.assignedEmployeeId,
      createdByUserId: task.createdByUserId,
      completedByUserId: task.completedByUserId,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
      source,
      version: task.version,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private async readTask(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    taskId: string,
    permission: 'operations.read' | 'operations.tasks.manage',
  ) {
    const [task] = await transaction
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, principal.tenantId), eq(tasks.id, taskId)))
      .limit(1);
    if (!task) throw new OperationsTaskNotFoundError();
    assertCan(principal, { action: permission, resource: taskResource(task) });
    await this.assertTaskClientAccess(transaction, principal, task);
    return task;
  }

  private async assertTaskClientAccess(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    task: typeof tasks.$inferSelect,
  ) {
    if (!task.clientId) return;
    const [client] = await transaction
      .select({
        id: clientRecords.id,
        organizationId: clientRecords.organizationId,
        facilityId: clientRecords.primaryFacilityId,
      })
      .from(clientRecords)
      .where(
        and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, task.clientId)),
      )
      .limit(1);
    if (!client) throw new OperationsTaskNotFoundError();
    assertCan(principal, {
      action: 'client.read',
      resource: {
        tenantId: principal.tenantId,
        clientId: client.id,
        ...(client.organizationId ? { organizationId: client.organizationId } : {}),
        ...(client.facilityId ? { facilityId: client.facilityId } : {}),
      },
    });
  }

  private async addActivity(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    task: typeof tasks.$inferSelect,
    kind: (typeof taskActivity.$inferInsert)['kind'],
    details: Record<string, unknown>,
  ) {
    await transaction.insert(taskActivity).values({
      id: uuidv7(),
      tenantId: principal.tenantId,
      taskId: task.id,
      actorUserId: principal.userId,
      kind,
      details,
      comment: null,
      occurredAt: new Date(),
    });
  }

  private async validateSource(
    principal: AuthorizationPrincipal,
    source: OperationsSourceReference,
  ): Promise<TaskResourceContext> {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      let result: TaskResourceContext | null = null;
      switch (source.type) {
        case 'client': {
          const [row] = await transaction
            .select()
            .from(clientRecords)
            .where(
              and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, source.id)),
            )
            .limit(1);
          result = row?.organizationId
            ? {
                organizationId: row.organizationId,
                facilityId: row.primaryFacilityId,
                clientId: row.id,
              }
            : null;
          break;
        }
        case 'visit': {
          const [row] = await transaction
            .select()
            .from(visits)
            .where(and(eq(visits.tenantId, principal.tenantId), eq(visits.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'service_agreement': {
          const [row] = await transaction
            .select()
            .from(agreements)
            .where(and(eq(agreements.tenantId, principal.tenantId), eq(agreements.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'service_evidence': {
          const [row] = await transaction
            .select({ visit: visits })
            .from(evidencePackages)
            .innerJoin(
              careDocuments,
              and(
                eq(careDocuments.tenantId, evidencePackages.tenantId),
                eq(careDocuments.id, evidencePackages.documentationId),
              ),
            )
            .innerJoin(
              visits,
              and(
                eq(visits.tenantId, careDocuments.tenantId),
                eq(visits.id, careDocuments.visitId),
              ),
            )
            .where(
              and(
                eq(evidencePackages.tenantId, principal.tenantId),
                eq(evidencePackages.id, source.id),
              ),
            )
            .limit(1);
          result = row
            ? {
                organizationId: row.visit.organizationId,
                facilityId: row.visit.facilityId,
                clientId: row.visit.clientId,
              }
            : null;
          break;
        }
        case 'invoice': {
          const [row] = await transaction
            .select()
            .from(invoices)
            .where(and(eq(invoices.tenantId, principal.tenantId), eq(invoices.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'claim': {
          const [row] = await transaction
            .select()
            .from(claims)
            .where(and(eq(claims.tenantId, principal.tenantId), eq(claims.id, source.id)))
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'benefit_entitlement': {
          const [row] = await transaction
            .select({ entitlement: clientBenefitEntitlements, client: clientRecords })
            .from(clientBenefitEntitlements)
            .innerJoin(
              clientRecords,
              and(
                eq(clientRecords.tenantId, clientBenefitEntitlements.tenantId),
                eq(clientRecords.id, clientBenefitEntitlements.clientId),
              ),
            )
            .where(
              and(
                eq(clientBenefitEntitlements.tenantId, principal.tenantId),
                eq(clientBenefitEntitlements.id, source.id),
              ),
            )
            .limit(1);
          result = row?.client.organizationId
            ? {
                organizationId: row.client.organizationId,
                facilityId: row.client.primaryFacilityId,
                clientId: row.client.id,
              }
            : null;
          break;
        }
        case 'document': {
          const [row] = await transaction
            .select()
            .from(documentArtifacts)
            .where(
              and(
                eq(documentArtifacts.tenantId, principal.tenantId),
                eq(documentArtifacts.id, source.id),
              ),
            )
            .limit(1);
          result = row
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
        case 'communication': {
          const resultSet = await transaction.execute(sql`
            SELECT client.organization_id AS "organizationId",
                   client.primary_facility_id AS "facilityId",
                   interaction.client_id AS "clientId"
            FROM communications.interactions AS interaction
            INNER JOIN clients.clients AS client
              ON client.tenant_id = interaction.tenant_id
             AND client.id = interaction.client_id
            WHERE interaction.tenant_id = ${principal.tenantId}
              AND interaction.id = ${source.id}
            LIMIT 1
          `);
          const row = resultSet.rows[0] as
            | { organizationId: string | null; facilityId: string | null; clientId: string }
            | undefined;
          result = row?.organizationId
            ? {
                organizationId: row.organizationId,
                facilityId: row.facilityId,
                clientId: row.clientId,
              }
            : null;
          break;
        }
      }
      if (!result) throw new OperationsSourceNotFoundError();
      assertCan(principal, {
        action: sourcePermission(source.type),
        resource: {
          tenantId: principal.tenantId,
          organizationId: result.organizationId,
          ...(result.facilityId ? { facilityId: result.facilityId } : {}),
          ...(result.clientId ? { clientId: result.clientId } : {}),
        },
      });
      return result;
    });
  }

  private async clientContext(
    principal: AuthorizationPrincipal,
    clientId: string,
  ): Promise<TaskResourceContext> {
    return this.validateSource(principal, { type: 'client', id: clientId });
  }

  private async assertTaskScope(resource: ResourceContext) {
    const result = await this.unitOfWork.transaction(
      { tenantId: resource.tenantId },
      async (transaction) => {
        const [organization] = await transaction
          .select({ id: organizationsTable.id })
          .from(organizationsTable)
          .where(
            and(
              eq(organizationsTable.tenantId, resource.tenantId),
              eq(organizationsTable.id, resource.organizationId!),
            ),
          )
          .limit(1);
        if (!organization) return false;
        if (!resource.facilityId) return true;
        const [facility] = await transaction
          .select({ id: facilities.id })
          .from(facilities)
          .where(
            and(
              eq(facilities.tenantId, resource.tenantId),
              eq(facilities.organizationId, resource.organizationId!),
              eq(facilities.id, resource.facilityId),
            ),
          )
          .limit(1);
        return facility !== undefined;
      },
    );
    if (!result) throw new InvalidOperationsInputError();
  }

  private async validateAssignee(
    transaction: DatabaseTransaction,
    tenantId: string,
    employeeId: string,
    organizationId: string,
    facilityId: string | null,
  ) {
    const filters = [
      eq(employeeRecords.tenantId, tenantId),
      eq(employeeRecords.id, employeeId),
      eq(employeeRecords.status, 'active'),
      eq(employeeRecords.organizationId, organizationId),
    ];
    const [employee] = await transaction
      .select({ id: employeeRecords.id })
      .from(employeeRecords)
      .where(and(...filters))
      .for('share')
      .limit(1);
    if (!employee) throw new OperationsAssigneeInvalidError();
    if (facilityId) {
      const [assignment] = await transaction
        .select({ id: employeeFacilityAssignments.id })
        .from(employeeFacilityAssignments)
        .where(
          and(
            eq(employeeFacilityAssignments.tenantId, tenantId),
            eq(employeeFacilityAssignments.organizationId, organizationId),
            eq(employeeFacilityAssignments.employeeId, employeeId),
            eq(employeeFacilityAssignments.facilityId, facilityId),
            eq(employeeFacilityAssignments.status, 'active'),
          ),
        )
        .for('share')
        .limit(1);
      if (!assignment) throw new OperationsAssigneeInvalidError();
    }
  }

  private async employeeForUser(tenantId: string, userId: string) {
    const rows = await this.unitOfWork.transaction({ tenantId }, async (transaction) =>
      transaction
        .select({ id: employeeRecords.id })
        .from(employeeRecords)
        .where(
          and(
            eq(employeeRecords.tenantId, tenantId),
            eq(employeeRecords.userId, userId),
            eq(employeeRecords.status, 'active'),
          ),
        )
        .limit(1),
    );
    return rows[0]?.id ?? null;
  }

  private async clientResources(tenantId: string, clientIds: string[]) {
    if (!clientIds.length)
      return new Map<string, { organizationId: string | null; facilityId: string | null }>();
    const rows = await this.unitOfWork.transaction({ tenantId }, async (transaction) =>
      transaction
        .select({
          id: clientRecords.id,
          organizationId: clientRecords.organizationId,
          facilityId: clientRecords.primaryFacilityId,
        })
        .from(clientRecords)
        .where(
          and(
            eq(clientRecords.tenantId, tenantId),
            inArray(clientRecords.id, [...new Set(clientIds)]),
          ),
        ),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { organizationId: row.organizationId, facilityId: row.facilityId },
      ]),
    );
  }

  private async organizationTimezones(tenantId: string, organizationIds: string[]) {
    const ids = [...new Set(organizationIds)];
    if (!ids.length) return new Map<string, string>();
    const rows = await this.unitOfWork.transaction({ tenantId }, async (transaction) =>
      transaction
        .select({
          id: organizationsTable.id,
          timezone: organizationsTable.timezone,
        })
        .from(organizationsTable)
        .where(and(eq(organizationsTable.tenantId, tenantId), inArray(organizationsTable.id, ids))),
    );
    return new Map(rows.map((row) => [row.id, row.timezone]));
  }

  private taskScopeConditions(principal: AuthorizationPrincipal): SQL[] | null {
    const grants = principal.grants.filter((grant) => grant.permission === 'operations.read');
    const tenantWide = grants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    );
    const organizationIds = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
      ),
    ];
    const facilitiesInScope = [
      ...new Set(
        grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
      ),
    ];
    if (!tenantWide && !organizationIds.length && !facilitiesInScope.length) return [];

    const taskScope: SQL | null = tenantWide
      ? null
      : or(
          ...(organizationIds.length ? [inArray(tasks.organizationId, organizationIds)] : []),
          ...(facilitiesInScope.length ? [inArray(tasks.facilityId, facilitiesInScope)] : []),
        )!;

    const clientGrants = principal.grants.filter((grant) => grant.permission === 'client.read');
    const clientTenantWide = clientGrants.some(
      (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
    );
    const clientOrganizationIds = [
      ...new Set(
        clientGrants
          .filter((grant) => grant.scopeType === 'organization')
          .map((grant) => grant.scopeId),
      ),
    ];
    const clientFacilityIds = [
      ...new Set(
        clientGrants
          .filter((grant) => grant.scopeType === 'facility')
          .map((grant) => grant.scopeId),
      ),
    ];
    const conditions: SQL[] = taskScope ? [taskScope] : [];
    if (!clientTenantWide) {
      const clientScopes: SQL[] = [];
      if (clientOrganizationIds.length) {
        clientScopes.push(inArray(clientRecords.organizationId, clientOrganizationIds));
      }
      if (clientFacilityIds.length) {
        clientScopes.push(inArray(clientRecords.primaryFacilityId, clientFacilityIds));
      }
      if (!clientScopes.length) {
        conditions.push(isNull(tasks.clientId));
      } else {
        const readableClient = exists(sql`
          SELECT 1 FROM ${clientRecords}
          WHERE ${clientRecords.tenantId} = ${tasks.tenantId}
            AND ${clientRecords.id} = ${tasks.clientId}
            AND ${or(...clientScopes)}
        `);
        conditions.push(or(isNull(tasks.clientId), readableClient)!);
      }
    }
    return conditions.length ? conditions : null;
  }

  private requireAnyGrant(principal: AuthorizationPrincipal, permission: Permission) {
    if (!hasGrant(principal, permission)) throw new AuthorizationDeniedError(permission);
  }

  private workItem(input: {
    sourceDomain: string;
    entityType: string;
    entityId: string;
    issueCode: string;
    category: OperationsWorkItem['category'];
    severity: OperationsWorkItem['severity'];
    organizationId: string | null;
    facilityId: string | null;
    clientId: string | null;
    clientName: string | null;
    dueAt: string | null;
    sourceAt?: Date | null;
    descriptionCode: string;
  }): ProjectedOperationsWorkItem {
    const { entityType, entityId, sourceAt, ...workItem } = input;
    const id = stableIssueId(input.sourceDomain, entityType, entityId, input.issueCode);
    return {
      ...workItem,
      [projectionSourceAt]: sourceAt ?? (input.dueAt ? new Date(input.dueAt) : null),
      id,
      kind: 'exception',
      sourceEntityType: entityType,
      sourceEntityId: entityId,
      titleCode: `operations.issueTitles.${input.issueCode}`,
      categoryLabelCode: `operations.categories.${input.category}`,
      status: 'open',
      firstDetectedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      interaction: null,
    };
  }

  private async reconcileStaleExceptionOccurrences(
    principal: AuthorizationPrincipal,
    currentItems: ProjectedOperationsWorkItem[],
    observedAt: Date,
  ) {
    const currentKeys = new Set(currentItems.map((item) => item.id));
    const candidates = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      (transaction) =>
        transaction
          .select()
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              isNull(exceptionOccurrences.resolvedAt),
              lt(exceptionOccurrences.lastObservedAt, observedAt),
              inArray(exceptionOccurrences.sourceDomain, [
                'scheduling',
                'care_documentation',
                'service_evidence',
                'onboarding',
              ]),
            ),
          )
          .orderBy(asc(exceptionOccurrences.lastObservedAt), asc(exceptionOccurrences.id))
          .limit(200),
    );
    const resolvable = candidates
      .filter((row) => {
        if (currentKeys.has(row.issueKey)) return false;
        const permission = exceptionReadPermission(row.sourceDomain, row.issueCode);
        const resource: ResourceContext = {
          tenantId: row.tenantId,
          ...(row.organizationId ? { organizationId: row.organizationId } : {}),
          ...(row.facilityId ? { facilityId: row.facilityId } : {}),
          ...(row.clientId ? { clientId: row.clientId } : {}),
        };
        return (
          permission !== null &&
          can(principal, { action: 'operations.read', resource }) &&
          can(principal, { action: permission, resource })
        );
      })
      .slice(0, MAX_STALE_EXCEPTION_RECONCILIATIONS);
    if (!resolvable.length) return;

    const resolved: Array<{ id: string; lastObservedAt: Date }> = [];
    // Keep this bounded read sequential so one refresh cannot burst dozens of source transactions.
    // oxlint-disable no-await-in-loop
    for (const occurrence of resolvable) {
      const stillCurrent = await this.staleOccurrenceStillCurrent(principal, occurrence);
      if (stillCurrent === false) {
        resolved.push({ id: occurrence.id, lastObservedAt: occurrence.lastObservedAt });
      }
    }
    // oxlint-enable no-await-in-loop
    if (!resolved.length) return;

    const expected = sql.join(
      resolved.map((row) => sql`(${row.id}::uuid, ${row.lastObservedAt}::timestamptz)`),
      sql`, `,
    );
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, (transaction) =>
      transaction.execute(sql`
        UPDATE operations.exception_occurrences AS occurrence
        SET resolved_at = ${observedAt}, version = occurrence.version + 1
        FROM (VALUES ${expected}) AS checked(id, last_observed_at)
        WHERE occurrence.tenant_id = ${principal.tenantId}
          AND occurrence.id = checked.id
          AND occurrence.resolved_at IS NULL
          AND occurrence.last_observed_at = checked.last_observed_at
      `),
    );
  }

  private async staleOccurrenceStillCurrent(
    principal: AuthorizationPrincipal,
    occurrence: typeof exceptionOccurrences.$inferSelect,
  ): Promise<boolean | null> {
    if (occurrence.sourceDomain === 'scheduling' && occurrence.sourceEntityType === 'visit') {
      try {
        const result = await this.sources.scheduling.getWorklistForVisit(
          principal,
          occurrence.sourceEntityId,
        );
        if (!result.complete) return null;
        return (
          result.item?.conflicts.some((conflict) => conflict.code === occurrence.issueCode) ?? false
        );
      } catch (error) {
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof VisitNotFoundError ||
          error instanceof VisitOutsideProviderContextError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (
      occurrence.sourceDomain === 'care_documentation' &&
      occurrence.sourceEntityType === 'visit'
    ) {
      try {
        const detail = await this.sources.documentation.getForVisit(
          principal,
          occurrence.sourceEntityId,
        );
        return detail.completeness.missing.some(
          (item) => `documentation_${item.code.toLowerCase()}` === occurrence.issueCode,
        );
      } catch (error) {
        if (error instanceof CareDocumentationNotFoundError) return false;
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof CareDocumentationVisitRelationshipRequiredError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (occurrence.sourceDomain === 'service_evidence') {
      if (occurrence.sourceEntityType === 'documentation') return false;
      if (occurrence.sourceEntityType !== 'evidence_package') return null;
      try {
        const evidencePackage = await this.sources.evidence.getPackage(
          principal,
          occurrence.sourceEntityId,
        );
        return evidencePackageIssueCode(evidencePackage.status) === occurrence.issueCode;
      } catch (error) {
        if (error instanceof EvidencePackageNotFoundError) return false;
        if (
          error instanceof AuthorizationDeniedError ||
          error instanceof ServiceEvidenceVisitRelationshipRequiredError
        ) {
          return null;
        }
        throw error;
      }
    }
    if (
      occurrence.sourceDomain === 'onboarding' &&
      occurrence.sourceEntityType === 'admission_case'
    ) {
      if (!this.sources.onboarding) return null;
      try {
        const state = await this.sources.onboarding.operationsIssueState(
          principal,
          occurrence.sourceEntityId,
        );
        if (occurrence.issueCode === 'admission_readiness_blocked') return state.readinessBlocked;
        if (occurrence.issueCode === 'admission_follow_up_overdue') return state.followUpOverdue;
        return null;
      } catch (error) {
        if (
          error instanceof AuthorizationDeniedError ||
          (error instanceof Error && 'code' in error && error.code === 'ONBOARDING_CASE_NOT_FOUND')
        ) {
          return null;
        }
        throw error;
      }
    }
    return null;
  }

  private async syncExceptionOccurrences(
    principal: AuthorizationPrincipal,
    items: ProjectedOperationsWorkItem[],
    completeDomains: Map<string, ReconciliationWindow>,
    observedAt: Date,
  ) {
    const currentItems = deduplicateWorkItems(items);
    const issueKeys = [...new Set(currentItems.map((item) => item.id))];
    await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${principal.tenantId}, 0))
      `);
      const activeCurrent = issueKeys.length
        ? await transaction
            .select({ id: exceptionOccurrences.id, issueKey: exceptionOccurrences.issueKey })
            .from(exceptionOccurrences)
            .where(
              and(
                eq(exceptionOccurrences.tenantId, principal.tenantId),
                inArray(exceptionOccurrences.issueKey, issueKeys),
                isNull(exceptionOccurrences.resolvedAt),
              ),
            )
        : [];
      const activeKeys = new Set(activeCurrent.map((row) => row.issueKey));
      const missing = currentItems.filter((item) => !activeKeys.has(item.id));
      if (missing.length) {
        const latestResolved = await transaction
          .select({
            issueKey: exceptionOccurrences.issueKey,
            resolvedAt: max(exceptionOccurrences.resolvedAt),
          })
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(
                exceptionOccurrences.issueKey,
                missing.map((item) => item.id),
              ),
              isNotNull(exceptionOccurrences.resolvedAt),
            ),
          )
          .groupBy(exceptionOccurrences.issueKey);
        const resolvedAtByKey = new Map(
          latestResolved.map((row) => [row.issueKey, row.resolvedAt]),
        );
        const candidates = missing.filter((item) => {
          const resolvedAt = resolvedAtByKey.get(item.id);
          return !resolvedAt || resolvedAt <= observedAt;
        });
        if (candidates.length) {
          await transaction
            .insert(exceptionOccurrences)
            .values(
              candidates.map((item) => ({
                id: uuidv7(),
                tenantId: principal.tenantId,
                issueKey: item.id,
                sourceDomain: item.sourceDomain,
                sourceEntityType: item.sourceEntityType,
                sourceEntityId: item.sourceEntityId,
                issueCode: item.issueCode,
                category: item.category,
                severity: item.severity,
                organizationId: item.organizationId,
                facilityId: item.facilityId,
                clientId: item.clientId,
                sourceAt: item[projectionSourceAt],
                firstDetectedAt: observedAt,
                lastObservedAt: observedAt,
                resolvedAt: null,
                version: 1,
              })),
            )
            .onConflictDoNothing();
        }
      }

      if (currentItems.length) {
        const observedValues = sql.join(
          currentItems.map((item) => sql`(${item.id}, ${item[projectionSourceAt]}::timestamptz)`),
          sql`, `,
        );
        await transaction.execute(sql`
          UPDATE operations.exception_occurrences AS occurrence
          SET last_observed_at = ${observedAt},
              source_at = observed.source_at,
              version = occurrence.version + 1
          FROM (VALUES ${observedValues}) AS observed(issue_key, source_at)
          WHERE occurrence.tenant_id = ${principal.tenantId}
            AND occurrence.issue_key = observed.issue_key
            AND occurrence.resolved_at IS NULL
            AND occurrence.last_observed_at < ${observedAt}
        `);
      }

      if (!completeDomains.size) return;
      const activeRows = await transaction
        .select()
        .from(exceptionOccurrences)
        .where(
          and(
            eq(exceptionOccurrences.tenantId, principal.tenantId),
            inArray(exceptionOccurrences.sourceDomain, [...completeDomains.keys()]),
            isNull(exceptionOccurrences.resolvedAt),
            lt(exceptionOccurrences.lastObservedAt, observedAt),
          ),
        );
      const currentKeySet = new Set(issueKeys);
      const resolvedIds = activeRows
        .filter((row) => {
          if (currentKeySet.has(row.issueKey)) return false;
          const window = completeDomains.get(row.sourceDomain);
          if (!window) return false;
          if (
            window.sourceEntityKeys &&
            !window.sourceEntityKeys.has(sourceEntityKey(row.sourceEntityType, row.sourceEntityId))
          ) {
            return false;
          }
          if (
            (window.from && (!row.sourceAt || row.sourceAt < window.from)) ||
            (window.until && (!row.sourceAt || row.sourceAt >= window.until))
          ) {
            return false;
          }
          const resource: ResourceContext = {
            tenantId: row.tenantId,
            ...(row.organizationId ? { organizationId: row.organizationId } : {}),
            ...(row.facilityId ? { facilityId: row.facilityId } : {}),
            ...(row.clientId ? { clientId: row.clientId } : {}),
          };
          const readPermission = exceptionReadPermission(row.sourceDomain, row.issueCode);
          return (
            readPermission !== null &&
            can(principal, { action: 'operations.read', resource }) &&
            can(principal, { action: readPermission, resource })
          );
        })
        .map((row) => row.id);
      if (resolvedIds.length) {
        await transaction
          .update(exceptionOccurrences)
          .set({ resolvedAt: observedAt, version: sql`${exceptionOccurrences.version} + 1` })
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(exceptionOccurrences.id, resolvedIds),
              isNull(exceptionOccurrences.resolvedAt),
              lt(exceptionOccurrences.lastObservedAt, observedAt),
            ),
          );
      }
    });
  }

  private async attachInteractions(
    principal: AuthorizationPrincipal,
    items: ProjectedOperationsWorkItem[],
  ) {
    if (!items.length) return items;
    const issueKeys = [...new Set(items.map((item) => item.id))];
    const [occurrences, interactions] = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const active = await transaction
          .select()
          .from(exceptionOccurrences)
          .where(
            and(
              eq(exceptionOccurrences.tenantId, principal.tenantId),
              inArray(exceptionOccurrences.issueKey, issueKeys),
              isNull(exceptionOccurrences.resolvedAt),
            ),
          );
        const occurrenceIds = active.map((row) => row.id);
        const history = occurrenceIds.length
          ? await transaction
              .select()
              .from(exceptionInteractions)
              .where(
                and(
                  eq(exceptionInteractions.tenantId, principal.tenantId),
                  inArray(exceptionInteractions.occurrenceId, occurrenceIds),
                ),
              )
              .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
          : [];
        return [active, history] as const;
      },
    );
    const occurrenceByKey = new Map(occurrences.map((row) => [row.issueKey, row]));
    const latest = new Map<string, (typeof interactions)[number]>();
    for (const row of interactions) {
      if (row.occurrenceId && !latest.has(row.occurrenceId)) latest.set(row.occurrenceId, row);
    }
    const now = Date.now();
    return items.map((item) => {
      const occurrence = occurrenceByKey.get(item.id);
      if (!occurrence) return item;
      const current = {
        ...item,
        firstDetectedAt: occurrence.firstDetectedAt.toISOString(),
        lastObservedAt: occurrence.lastObservedAt.toISOString(),
      };
      const interaction = latest.get(occurrence.id);
      if (!interaction) return current;
      const status: OperationsWorkItem['status'] =
        interaction.action === 'snoozed' &&
        interaction.snoozedUntil &&
        interaction.snoozedUntil.getTime() > now
          ? 'snoozed'
          : interaction.action === 'acknowledged'
            ? 'acknowledged'
            : 'open';
      return {
        ...current,
        status,
        interaction: {
          action: interaction.action,
          occurredAt: interaction.occurredAt.toISOString(),
          previousState: interaction.previousState,
          snoozedUntil: interaction.snoozedUntil?.toISOString() ?? null,
          reason: interaction.reason,
        },
      };
    });
  }

  private async latestExceptionInteraction(
    transaction: DatabaseTransaction,
    tenantId: string,
    occurrenceId: string,
  ) {
    const [interaction] = await transaction
      .select()
      .from(exceptionInteractions)
      .where(
        and(
          eq(exceptionInteractions.tenantId, tenantId),
          eq(exceptionInteractions.occurrenceId, occurrenceId),
        ),
      )
      .orderBy(desc(exceptionInteractions.occurredAt), desc(exceptionInteractions.id))
      .limit(1);
    return interaction ?? null;
  }

  private async activeExceptionOccurrence(
    transaction: DatabaseTransaction,
    tenantId: string,
    issueKey: string,
  ) {
    const [occurrence] = await transaction
      .select()
      .from(exceptionOccurrences)
      .where(
        and(
          eq(exceptionOccurrences.tenantId, tenantId),
          eq(exceptionOccurrences.issueKey, issueKey),
          isNull(exceptionOccurrences.resolvedAt),
        ),
      )
      .limit(1);
    return occurrence ?? null;
  }

  private async findCurrentWorkItem(principal: AuthorizationPrincipal, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new OperationsWorkItemNotFoundError();
    const first = await this.listWorkItems(principal, { page: 1, pageSize: 1000 });
    const pages = Math.min(10, Math.ceil(first.total / 1000));
    if (first.items.some((item) => item.id === id))
      return first.items.find((item) => item.id === id)!;
    for (let page = 2; page <= pages; page++) {
      const result = await this.listWorkItems(principal, { page, pageSize: 1000 });
      const found = result.items.find((item) => item.id === id);
      if (found) return found;
    }
    throw new OperationsWorkItemNotFoundError();
  }

  private async recordStateChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: {
      type: string;
      action: string;
      aggregateId: string;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ) {
    const event = createDomainEvent({
      type: input.type as import('@care/events').EventName,
      tenantId: principal.tenantId,
      aggregateType: 'operations',
      aggregateId: input.aggregateId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload: input.payload as never,
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'office_task',
      resourceId: input.aggregateId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
    await this.outbox.enqueue(transaction, event);
  }

  private async recordAudit(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    input: { action: string; resourceId: string; metadata: Record<string, unknown> },
  ) {
    await this.audit.append(transaction, {
      id: uuidv7(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.action,
      resourceType: 'office_task',
      resourceId: input.resourceId,
      timestamp: new Date(),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata: input.metadata,
    });
  }

  private async recordExceptionChange(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    request: RequestContext,
    auditContext: AuditContext,
    item: OperationsWorkItem,
    occurrenceId: string,
    action: 'acknowledged' | 'snoozed',
    snoozedUntil?: Date,
  ) {
    const type =
      action === 'acknowledged'
        ? 'operations.exception_acknowledged'
        : 'operations.exception_snoozed';
    const payload =
      action === 'acknowledged'
        ? { issueKey: item.id, occurrenceId }
        : { issueKey: item.id, occurrenceId, snoozedUntil: snoozedUntil!.toISOString() };
    const event = createDomainEvent({
      type,
      tenantId: principal.tenantId,
      aggregateType: 'operations',
      aggregateId: item.sourceEntityId,
      actor: { type: 'user', id: principal.userId },
      correlationId: request.correlationId,
      payload,
    });
    await this.audit.append(transaction, {
      id: event.id,
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: type,
      resourceType: 'operational_exception',
      resourceId: item.sourceEntityId,
      timestamp: new Date(event.occurredAt),
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...auditContext,
      metadata:
        action === 'acknowledged'
          ? { issueKey: item.id, occurrenceId }
          : { issueKey: item.id, occurrenceId, snoozedUntil: snoozedUntil!.toISOString() },
    });
    await this.outbox.enqueue(transaction, event);
  }
}

export class InvalidOperationsInputError extends Error {
  readonly code = 'OPERATIONS_INVALID_INPUT';
  constructor() {
    super('The operations request is invalid');
  }
}
export class OperationsTaskNotFoundError extends Error {
  readonly code = 'OPERATIONS_TASK_NOT_FOUND';
  constructor() {
    super('The task was not found');
  }
}
export class OperationsWorkItemNotFoundError extends Error {
  readonly code = 'OPERATIONS_WORK_ITEM_NOT_FOUND';
  constructor() {
    super('The operational work item was not found');
  }
}
export class OperationsSourceNotFoundError extends Error {
  readonly code = 'OPERATIONS_SOURCE_NOT_FOUND';
  constructor() {
    super('The referenced source record was not found');
  }
}
export class OperationsAssigneeInvalidError extends Error {
  readonly code = 'OPERATIONS_ASSIGNEE_INVALID';
  constructor() {
    super('The assignee is not active in this task scope');
  }
}
export class OperationsTaskVersionConflictError extends Error {
  readonly code = 'OPERATIONS_TASK_VERSION_CONFLICT';
  constructor() {
    super('The task changed in another Office session');
  }
}
export class OperationsTaskStateError extends Error {
  readonly code = 'OPERATIONS_TASK_INVALID_STATE';
  constructor() {
    super('The task cannot make the requested transition');
  }
}

export interface OperationsTaskListQuery {
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedEmployeeId?: string;
  assignedToMe?: boolean;
  due?: 'overdue' | 'today' | 'upcoming';
  search?: string;
  order?: 'due' | 'created';
  page?: number;
  pageSize?: number;
}

export function createOperationsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
  sources: OperationsSourceServices,
) {
  return new OperationsApplicationService(unitOfWork, audit, outbox, sources);
}

interface TaskResourceContext {
  organizationId: string;
  facilityId: string | null;
  clientId: string | null;
}

function hasGrant(principal: AuthorizationPrincipal, permission: Permission): boolean {
  return principal.grants.some((grant) => grant.permission === permission);
}

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > maximum)
    throw new InvalidOperationsInputError();
  return result;
}

function validTaskInput(input: OperationsTaskInput): boolean {
  return (
    typeof input.title === 'string' &&
    input.title.trim().length > 0 &&
    input.title.trim().length <= 200 &&
    (input.description == null ||
      (typeof input.description === 'string' && input.description.length <= 8000)) &&
    (input.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(input.priority)) &&
    (input.dueAt === undefined || input.dueAt === null || Number.isFinite(input.dueAt.getTime())) &&
    (input.source === undefined ||
      input.source === null ||
      (validSourceType(input.source.type) && isUuid(input.source.id)))
  );
}

function validPatch(input: OperationsTaskPatch): boolean {
  return (
    (input.title === undefined ||
      (typeof input.title === 'string' &&
        input.title.trim().length > 0 &&
        input.title.trim().length <= 200)) &&
    (input.description === undefined ||
      input.description === null ||
      (typeof input.description === 'string' && input.description.length <= 8000)) &&
    (input.priority === undefined ||
      ['low', 'normal', 'high', 'urgent'].includes(input.priority)) &&
    (input.assignedEmployeeId === undefined ||
      input.assignedEmployeeId === null ||
      isUuid(input.assignedEmployeeId)) &&
    (input.dueAt === undefined || input.dueAt === null || Number.isFinite(input.dueAt.getTime()))
  );
}

function validSourceType(value: string): value is SourceType {
  return [
    'client',
    'visit',
    'service_agreement',
    'service_evidence',
    'invoice',
    'claim',
    'benefit_entitlement',
    'document',
    'communication',
  ].includes(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function taskResource(
  task: Pick<typeof tasks.$inferSelect, 'tenantId' | 'organizationId' | 'facilityId' | 'clientId'>,
): ResourceContext {
  return {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    ...(task.facilityId ? { facilityId: task.facilityId } : {}),
    ...(task.clientId ? { clientId: task.clientId } : {}),
  };
}

function sourcePermission(type: SourceType): Permission {
  switch (type) {
    case 'client':
      return 'client.read';
    case 'visit':
      return 'schedule.read';
    case 'service_agreement':
      return 'service_agreement.read';
    case 'service_evidence':
      return 'service_evidence.read';
    case 'invoice':
      return 'billing.read';
    case 'claim':
      return 'claims.read';
    case 'benefit_entitlement':
      return 'benefits.read';
    case 'document':
      return 'documents.read';
    case 'communication':
      return 'communications.read';
  }
}

function sourceColumnsFor(source: OperationsSourceReference | null) {
  return {
    sourceClientId: source?.type === 'client' ? source.id : null,
    sourceVisitId: source?.type === 'visit' ? source.id : null,
    sourceAgreementId: source?.type === 'service_agreement' ? source.id : null,
    sourceEvidencePackageId: source?.type === 'service_evidence' ? source.id : null,
    sourceInvoiceId: source?.type === 'invoice' ? source.id : null,
    sourceClaimId: source?.type === 'claim' ? source.id : null,
    sourceEntitlementId: source?.type === 'benefit_entitlement' ? source.id : null,
    sourceDocumentId: source?.type === 'document' ? source.id : null,
    sourceCommunicationId: source?.type === 'communication' ? source.id : null,
  };
}

function sourceIdFromRow(task: typeof tasks.$inferSelect): string | null {
  switch (task.sourceType) {
    case 'client':
      return task.sourceClientId;
    case 'visit':
      return task.sourceVisitId;
    case 'service_agreement':
      return task.sourceAgreementId;
    case 'service_evidence':
      return task.sourceEvidencePackageId;
    case 'invoice':
      return task.sourceInvoiceId;
    case 'claim':
      return task.sourceClaimId;
    case 'benefit_entitlement':
      return task.sourceEntitlementId;
    case 'document':
      return task.sourceDocumentId;
    case 'communication':
      return task.sourceCommunicationId;
    default:
      return null;
  }
}

function sourceEntityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function deduplicateWorkItems<T extends OperationsWorkItem>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function exceptionReadPermission(sourceDomain: string, issueCode: string): Permission | null {
  switch (sourceDomain) {
    case 'scheduling':
      return 'schedule.read';
    case 'care_documentation':
      return 'care_documentation.review';
    case 'service_evidence':
      return 'service_evidence.read';
    case 'benefits':
      return 'benefits.review';
    case 'billing':
      return issueCode === 'receivable_overdue' ? 'billing.payments.read' : 'billing.read';
    case 'claims':
      return 'claims.read';
    case 'onboarding':
      return 'onboarding.read';
    default:
      return null;
  }
}

function severityWeight(severity: OperationsWorkItem['severity']): number {
  return severity === 'critical' ? 3 : severity === 'warning' ? 2 : 1;
}

function matchesDueFilter(
  dueAt: string | null,
  filter: NonNullable<OperationsQuery['due']>,
  now: Date,
  timezone: string,
): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return false;
  if (filter === 'overdue') return due < now;
  const dueDate = localDateKey(due, timezone);
  const today = localDateKey(now, timezone);
  return filter === 'today' ? dueDate === today : dueDate > today;
}

function taskDueLocalDates() {
  const timezone = sql`COALESCE((SELECT ${organizationsTable.timezone} FROM ${organizationsTable} WHERE ${organizationsTable.tenantId} = ${tasks.tenantId} AND ${organizationsTable.id} = ${tasks.organizationId} LIMIT 1), 'Europe/Berlin')`;
  return {
    dueDate: sql`(${tasks.dueAt} AT TIME ZONE ${timezone})::date`,
    today: sql`(now() AT TIME ZONE ${timezone})::date`,
  };
}

function localDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function endOfLocalDay(date: string, timezone: string): string | null {
  try {
    const lastMinute = localDateTimeToInstant(date, '23:59', timezone, 'later');
    return lastMinute ? new Date(lastMinute.getTime() + 59_999).toISOString() : null;
  } catch {
    return null;
  }
}

function workItemResource(
  principal: AuthorizationPrincipal,
  item: OperationsWorkItem,
): ResourceContext {
  return {
    tenantId: principal.tenantId,
    ...(item.organizationId ? { organizationId: item.organizationId } : {}),
    ...(item.facilityId ? { facilityId: item.facilityId } : {}),
    ...(item.clientId ? { clientId: item.clientId } : {}),
  };
}

function exceptionState(
  previous: typeof exceptionInteractions.$inferSelect | null,
  now: Date,
): 'open' | 'acknowledged' | 'snoozed' {
  if (!previous) return 'open';
  if (previous.action === 'acknowledged') return 'acknowledged';
  return previous.snoozedUntil && previous.snoozedUntil > now ? 'snoozed' : 'open';
}
