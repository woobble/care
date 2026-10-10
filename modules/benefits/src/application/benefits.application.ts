import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditWriter } from '@care/audit';
import type { RequestContext } from '@care/contracts';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { createDomainEvent } from '@care/events';
import { clientInsurances, clientRecords, pflegegradRecords } from '@care/clients';
import { organizationsTable } from '@care/organizations';
import { AuthorizationDeniedError, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import { ExportFilterInvalidError, ExportRowLimitExceededError } from '@care/documents';
import { calculateServicePriceCents, servicePrices } from '@care/services';
import { serviceDefinitions } from '@care/services';
import { visitServices, visits } from '@care/scheduling';
import { performedServices, visitExecutions } from '@care/visit-execution';
import {
  addCents,
  allocateFromBuckets,
  applicableRule,
  bucketRemainingCents,
  monthStart,
  monthlyEntitlementBuckets,
  nextMonth,
  serviceConsumptionInPeriodCents,
  serviceBenefitEligibility,
  type BenefitBucket,
  type BenefitLedgerFact,
  type BenefitRule,
  type BenefitType,
  type VerificationStatus,
} from '@module/benefits/domain/benefits';
import {
  BenefitAdjustmentConflictError,
  BenefitAllocationAlreadyReversedError,
  BenefitAllocationConflictError,
  BenefitAllocationNotFoundError,
  BenefitBudgetInsufficientError,
  BenefitClientNotFoundError,
  BenefitEntitlementNotFoundError,
  BenefitEntitlementPeriodConflictError,
  BenefitEntitlementVersionConflictError,
  BenefitFundingSourceNotFoundError,
  BenefitProviderRecognitionRequiredError,
  BenefitServiceNotEligibleError,
  InvalidBenefitAdjustmentError,
  InvalidBenefitEntitlementError,
  InvalidBenefitFundingSourceError,
  InvalidProviderRecognitionError,
} from '@module/benefits/domain/errors';
import {
  benefitAllocationBuckets,
  benefitDefinitions,
  benefitFundingSources,
  benefitLedgerEntries,
  benefitRuleVersions,
  clientBenefitEntitlements,
  providerRecognitions,
  serviceAllocationReversals,
  serviceAllocations,
} from '@module/benefits/schema';

type AuditContext = { ip?: string; userAgent?: string };
type BenefitPermission = Extract<Permission, `benefits.${string}`>;

export interface BenefitBillingAllocation {
  id: string;
  fundingSourceId: string;
  entitlementId: string | null;
  amountCents: number;
  status: 'provisional' | 'confirmed';
  sourceType: string;
  sourceLabel: string | null;
  clientInsuranceId: string | null;
}

export interface FundingSourceInput {
  sourceType:
    | 'statutory_long_term_care_insurance'
    | 'private_long_term_care_insurance'
    | 'self_pay'
    | 'other';
  clientInsuranceId?: string | null;
  label?: string | null;
}

export interface EntitlementInput {
  benefitType: BenefitType;
  fundingSourceId: string;
  validFrom: string;
  validUntil?: string | null;
  status: 'confirmed' | 'provisional';
  calculationMode: 'rule_based' | 'manual' | 'external_input';
  source: 'payer_confirmed' | 'client_reported' | 'provider_reported' | 'contract';
}

export interface BenefitAdjustmentInput {
  idempotencyKey: string;
  fundingSourceId: string;
  entitlementId?: string;
  benefitType: BenefitType;
  amountCents: number;
  effectiveDate: string;
  adjustmentType:
    | 'opening_balance'
    | 'external_consumption'
    | 'manual_adjustment'
    | 'external_input';
  sourceType: string;
  reference?: string | null;
  verificationStatus: VerificationStatus;
}

export interface ServiceAllocationInput {
  fundingSourceId: string;
  entitlementId: string;
  amountCents: number;
  status: 'provisional' | 'confirmed';
  idempotencyKey: string;
  manualServiceAmountCents?: number;
}

export interface BenefitAllocationExportFilters {
  from: string;
  until: string;
  organizationId?: string;
  facilityId?: string;
  clientId?: string;
  benefitType?: BenefitType;
  fundingSourceType?:
    | 'statutory_long_term_care_insurance'
    | 'private_long_term_care_insurance'
    | 'self_pay'
    | 'other';
}

export interface BenefitAllocationExportRow {
  allocationId: string;
  clientId: string;
  benefitType: BenefitType | null;
  fundingSourceId: string;
  fundingSourceType: string;
  fundingSourceLabel: string | null;
  serviceDate: string;
  performedServiceId: string;
  serviceCode: string;
  serviceName: string;
  amountCents: number;
  verificationStatus: 'provisional' | 'confirmed' | 'reversed';
  organizationId: string;
  facilityId: string;
}

// Transaction operations share one PostgreSQL connection and need deterministic query/write order.
// oxlint-disable no-await-in-loop
export class BenefitsApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async allocationsForBilling(
    transaction: DatabaseTransaction,
    tenantId: string,
    performedServiceId: string,
  ): Promise<BenefitBillingAllocation[]> {
    const rows = await transaction
      .select({
        id: serviceAllocations.id,
        fundingSourceId: serviceAllocations.fundingSourceId,
        entitlementId: serviceAllocations.entitlementId,
        amountCents: serviceAllocations.amountCents,
        status: serviceAllocations.status,
        sourceType: benefitFundingSources.sourceType,
        sourceLabel: benefitFundingSources.label,
        clientInsuranceId: benefitFundingSources.clientInsuranceId,
      })
      .from(serviceAllocations)
      .innerJoin(
        benefitFundingSources,
        and(
          eq(benefitFundingSources.tenantId, serviceAllocations.tenantId),
          eq(benefitFundingSources.clientId, serviceAllocations.clientId),
          eq(benefitFundingSources.id, serviceAllocations.fundingSourceId),
        ),
      )
      .leftJoin(
        serviceAllocationReversals,
        and(
          eq(serviceAllocationReversals.tenantId, serviceAllocations.tenantId),
          eq(serviceAllocationReversals.allocationId, serviceAllocations.id),
        ),
      )
      .where(
        and(
          eq(serviceAllocations.tenantId, tenantId),
          eq(serviceAllocations.performedServiceId, performedServiceId),
          isNull(serviceAllocationReversals.id),
        ),
      )
      .orderBy(asc(serviceAllocations.recordedAt), asc(serviceAllocations.id));
    return rows;
  }

  async fundingSourceForBilling(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    fundingSourceId: string,
  ) {
    const [source] = await transaction
      .select()
      .from(benefitFundingSources)
      .where(
        and(
          eq(benefitFundingSources.tenantId, tenantId),
          eq(benefitFundingSources.clientId, clientId),
          eq(benefitFundingSources.id, fundingSourceId),
        ),
      )
      .limit(1);
    return source ?? null;
  }

  async listDefinitions(principal: AuthorizationPrincipal) {
    this.requireAnyGrant(principal, 'benefits.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) =>
      transaction.select().from(benefitDefinitions).orderBy(asc(benefitDefinitions.id)),
    );
  }

  async listRules(principal: AuthorizationPrincipal) {
    this.requireAnyGrant(principal, 'benefits.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) =>
      transaction
        .select()
        .from(benefitRuleVersions)
        .orderBy(asc(benefitRuleVersions.benefitType), asc(benefitRuleVersions.effectiveFrom)),
    );
  }

  async getBudget(principal: AuthorizationPrincipal, clientId: string, asOf = today()) {
    assertDate(asOf);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(transaction, principal, clientId, 'benefits.read');
      const sources = await transaction
        .select()
        .from(benefitFundingSources)
        .where(
          and(
            eq(benefitFundingSources.tenantId, principal.tenantId),
            eq(benefitFundingSources.clientId, clientId),
          ),
        )
        .orderBy(asc(benefitFundingSources.createdAt));
      const entitlements = await transaction
        .select()
        .from(clientBenefitEntitlements)
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, principal.tenantId),
            eq(clientBenefitEntitlements.clientId, clientId),
          ),
        )
        .orderBy(asc(clientBenefitEntitlements.validFrom));
      const rules = await this.rules(transaction);
      const buckets = await transaction
        .select()
        .from(benefitAllocationBuckets)
        .where(
          and(
            eq(benefitAllocationBuckets.tenantId, principal.tenantId),
            eq(benefitAllocationBuckets.clientId, clientId),
          ),
        );
      const entries = await transaction
        .select()
        .from(benefitLedgerEntries)
        .where(
          and(
            eq(benefitLedgerEntries.tenantId, principal.tenantId),
            eq(benefitLedgerEntries.clientId, clientId),
          ),
        )
        .orderBy(desc(benefitLedgerEntries.effectiveDate), desc(benefitLedgerEntries.recordedAt));
      const projectedBuckets = this.projectedBuckets(buckets, entitlements, rules, asOf);
      const grade = await this.careGradeAt(transaction, principal.tenantId, clientId, asOf);
      const allocations = await transaction
        .select()
        .from(serviceAllocations)
        .where(
          and(
            eq(serviceAllocations.tenantId, principal.tenantId),
            eq(serviceAllocations.clientId, clientId),
          ),
        );
      const facts = entries.map(toLedgerFact);
      const currentMonth = monthStart(asOf);
      const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]));
      const entitlementBudgets = entitlements.map((entitlement) => {
        const entitlementBuckets = projectedBuckets.filter(
          (bucket) => bucket.entitlementId === entitlement.id,
        );
        const active = entitlementBuckets.filter(
          (bucket) =>
            bucket.originPeriod <= currentMonth &&
            (bucket.expiresAt === null || bucket.expiresAt >= asOf),
        );
        const hasRecordedBalance =
          entitlementBuckets.length > 0 && entitlement.benefitType !== 'private';
        const entitlementFacts = entries
          .filter((entry) => {
            const allocation = entry.serviceAllocationId
              ? allocationById.get(entry.serviceAllocationId)
              : undefined;
            return allocation?.entitlementId === entitlement.id;
          })
          .map(toLedgerFact);
        const actualConsumptionCents = serviceConsumptionInPeriodCents(
          entitlementFacts,
          asOf.slice(0, 7),
        );
        return {
          entitlementId: entitlement.id,
          benefitType: entitlement.benefitType,
          entitlementStatus: entitlement.status,
          fundingSourceId: entitlement.fundingSourceId,
          currentAllocationCents: entitlementBuckets
            .filter(
              (bucket) =>
                bucket.bucketType === 'monthly_entitlement' && bucket.originPeriod === currentMonth,
            )
            .reduce((sum, bucket) => addCents(sum, bucket.amountCents), 0),
          carryoverCents: entitlementBuckets
            .filter(
              (bucket) =>
                bucket.originPeriod.slice(0, 4) < asOf.slice(0, 4) &&
                bucket.expiresAt !== null &&
                bucket.expiresAt >= asOf,
            )
            .reduce(
              (sum, bucket) =>
                addCents(sum, bucketRemainingCents(bucket, facts, asOf, 'provisional')),
              0,
            ),
          estimatedRemainingCents: hasRecordedBalance
            ? active.reduce(
                (sum, bucket) =>
                  addCents(sum, bucketRemainingCents(bucket, facts, asOf, 'provisional')),
                0,
              )
            : null,
          confirmedRemainingCents: hasRecordedBalance
            ? active.reduce(
                (sum, bucket) =>
                  addCents(sum, bucketRemainingCents(bucket, facts, asOf, 'confirmed')),
                0,
              )
            : null,
          actualConsumptionCents,
          verificationStatuses: [...new Set(active.map((bucket) => bucket.verificationStatus))],
          nextExpiry:
            active
              .filter((bucket) => bucket.expiresAt !== null)
              .map((bucket) => bucket.expiresAt!)
              .sort()[0] ?? null,
        };
      });
      const plannedEligible45bCents = client.organizationId
        ? await this.plannedEligible45bConsumption(
            transaction,
            principal.tenantId,
            clientId,
            client.organizationId,
            currentMonth,
            entitlements,
            rules,
          )
        : 0;
      return {
        clientId,
        asOf,
        currentPeriod: currentMonth,
        careGrade: grade,
        fundingSources: sources.map((source) => ({
          id: source.id,
          clientId: source.clientId,
          sourceType: source.sourceType,
          clientInsuranceId: source.clientInsuranceId,
          label: source.label,
          status: source.status,
          unlimited: source.sourceType === 'self_pay',
          entitlements: entitlements
            .filter((entitlement) => entitlement.fundingSourceId === source.id)
            .map(toEntitlementResponse),
        })),
        entitlementBudgets,
        plannedEligible45bCents,
        entitlements: entitlements.map(toEntitlementResponse),
        history: entries.slice(0, 100).map((entry) => ({
          id: entry.id,
          clientId: entry.clientId,
          fundingSourceId: entry.fundingSourceId,
          allocationBucketId: entry.allocationBucketId,
          serviceAllocationId: entry.serviceAllocationId,
          performedServiceId: entry.performedServiceId,
          entryType: entry.entryType,
          amountCents: entry.amountCents,
          effectiveDate: entry.effectiveDate,
          sourceType: entry.sourceType,
          reference: entry.reference,
          verificationStatus: entry.verificationStatus,
          recordedAt: entry.recordedAt,
        })),
      };
    });
  }

  async exportAllocations(
    principal: AuthorizationPrincipal,
    filters: BenefitAllocationExportFilters,
  ): Promise<BenefitAllocationExportRow[]> {
    if (
      !isDate(filters.from) ||
      !isDate(filters.until) ||
      filters.from > filters.until ||
      daysBetween(filters.from, filters.until) > 366
    ) {
      throw new ExportFilterInvalidError();
    }
    if (!principal.grants.some((grant) => grant.permission === 'benefits.read')) {
      throw new AuthorizationDeniedError('benefits.read');
    }
    if (filters.organizationId) {
      if (
        !can(principal, {
          action: 'benefits.read',
          resource: { tenantId: principal.tenantId, organizationId: filters.organizationId },
        })
      )
        throw new AuthorizationDeniedError('benefits.read');
    }
    if (filters.facilityId) {
      if (
        !can(principal, {
          action: 'benefits.read',
          resource: {
            tenantId: principal.tenantId,
            ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
            facilityId: filters.facilityId,
          },
        })
      )
        throw new AuthorizationDeniedError('benefits.read');
    }
    if (filters.clientId) {
      await this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
        await this.requireClient(transaction, principal, filters.clientId!, 'benefits.read');
      });
    }
    const from = new Date(`${filters.from}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const until = new Date(`${filters.until}T00:00:00.000Z`);
    until.setUTCDate(until.getUTCDate() + 2);
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const where = [
        eq(serviceAllocations.tenantId, principal.tenantId),
        gte(visitExecutions.actualStart, from),
        lte(visitExecutions.actualStart, until),
      ];
      if (filters.organizationId) where.push(eq(visits.organizationId, filters.organizationId));
      if (filters.facilityId) where.push(eq(visits.facilityId, filters.facilityId));
      if (filters.clientId) where.push(eq(serviceAllocations.clientId, filters.clientId));
      if (filters.fundingSourceType)
        where.push(eq(benefitFundingSources.sourceType, filters.fundingSourceType));
      const rows = await transaction
        .select({
          allocationId: serviceAllocations.id,
          clientId: serviceAllocations.clientId,
          entitlementId: serviceAllocations.entitlementId,
          fundingSourceId: serviceAllocations.fundingSourceId,
          fundingSourceType: benefitFundingSources.sourceType,
          fundingSourceLabel: benefitFundingSources.label,
          benefitType: clientBenefitEntitlements.benefitType,
          amountCents: serviceAllocations.amountCents,
          status: serviceAllocations.status,
          reversedAt: serviceAllocationReversals.reversedAt,
          performedServiceId: performedServices.id,
          serviceCode: performedServices.serviceCodeSnapshot,
          serviceName: performedServices.serviceNameSnapshot,
          actualStart: visitExecutions.actualStart,
          timezone: visits.timezone,
          organizationId: visits.organizationId,
          facilityId: visits.facilityId,
        })
        .from(serviceAllocations)
        .innerJoin(
          benefitFundingSources,
          and(
            eq(benefitFundingSources.tenantId, serviceAllocations.tenantId),
            eq(benefitFundingSources.clientId, serviceAllocations.clientId),
            eq(benefitFundingSources.id, serviceAllocations.fundingSourceId),
          ),
        )
        .innerJoin(
          performedServices,
          and(
            eq(performedServices.tenantId, serviceAllocations.tenantId),
            eq(performedServices.id, serviceAllocations.performedServiceId),
          ),
        )
        .innerJoin(
          visitExecutions,
          and(
            eq(visitExecutions.tenantId, performedServices.tenantId),
            eq(visitExecutions.id, performedServices.executionId),
          ),
        )
        .innerJoin(
          visits,
          and(
            eq(visits.tenantId, visitExecutions.tenantId),
            eq(visits.id, visitExecutions.visitId),
          ),
        )
        .leftJoin(
          clientBenefitEntitlements,
          and(
            eq(clientBenefitEntitlements.tenantId, serviceAllocations.tenantId),
            eq(clientBenefitEntitlements.clientId, serviceAllocations.clientId),
            eq(clientBenefitEntitlements.id, serviceAllocations.entitlementId),
          ),
        )
        .leftJoin(
          serviceAllocationReversals,
          and(
            eq(serviceAllocationReversals.tenantId, serviceAllocations.tenantId),
            eq(serviceAllocationReversals.allocationId, serviceAllocations.id),
          ),
        )
        .where(and(...where))
        .orderBy(asc(visitExecutions.actualStart), asc(serviceAllocations.id))
        .limit(10_001);
      if (rows.length > 10_000) throw new ExportRowLimitExceededError();
      const result: BenefitAllocationExportRow[] = [];
      for (const row of rows) {
        const serviceDay = serviceDate(row.actualStart, row.timezone);
        if (serviceDay < filters.from || serviceDay > filters.until) continue;
        const resource = {
          tenantId: principal.tenantId,
          clientId: row.clientId,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
        };
        if (!can(principal, { action: 'benefits.read', resource })) continue;
        if (filters.benefitType && row.benefitType !== filters.benefitType) continue;
        result.push({
          allocationId: row.allocationId,
          clientId: row.clientId,
          benefitType: row.benefitType,
          fundingSourceId: row.fundingSourceId,
          fundingSourceType: row.fundingSourceType,
          fundingSourceLabel: row.fundingSourceLabel,
          serviceDate: serviceDay,
          performedServiceId: row.performedServiceId,
          serviceCode: row.serviceCode,
          serviceName: row.serviceName,
          amountCents: row.amountCents,
          verificationStatus: row.reversedAt ? 'reversed' : row.status,
          organizationId: row.organizationId,
          facilityId: row.facilityId,
        });
      }
      if (result.length > 5000) throw new ExportRowLimitExceededError();
      return result;
    });
  }

  async listFundingSources(principal: AuthorizationPrincipal, clientId: string) {
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.read');
      return transaction
        .select()
        .from(benefitFundingSources)
        .where(
          and(
            eq(benefitFundingSources.tenantId, principal.tenantId),
            eq(benefitFundingSources.clientId, clientId),
          ),
        )
        .orderBy(asc(benefitFundingSources.createdAt));
    });
  }

  async listHistory(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: {
      from?: string;
      until?: string;
      fundingSourceId?: string;
      entryType?: BenefitLedgerFact['entryType'];
      reference?: string;
      page: number;
      pageSize: number;
    },
  ) {
    if (
      (input.from !== undefined && !isDate(input.from)) ||
      (input.until !== undefined && !isDate(input.until)) ||
      (input.from !== undefined && input.until !== undefined && input.until < input.from) ||
      (input.fundingSourceId !== undefined && !isUuid(input.fundingSourceId)) ||
      (input.reference !== undefined && input.reference.length > 500) ||
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100
    )
      throw new InvalidBenefitAdjustmentError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.read');
      const filters = [
        eq(benefitLedgerEntries.tenantId, principal.tenantId),
        eq(benefitLedgerEntries.clientId, clientId),
        ...(input.from ? [gte(benefitLedgerEntries.effectiveDate, input.from)] : []),
        ...(input.until ? [lte(benefitLedgerEntries.effectiveDate, input.until)] : []),
        ...(input.fundingSourceId
          ? [eq(benefitLedgerEntries.fundingSourceId, input.fundingSourceId)]
          : []),
        ...(input.entryType ? [eq(benefitLedgerEntries.entryType, input.entryType)] : []),
        ...(input.reference ? [eq(benefitLedgerEntries.reference, input.reference)] : []),
      ];
      const items = await transaction
        .select()
        .from(benefitLedgerEntries)
        .where(and(...filters))
        .orderBy(desc(benefitLedgerEntries.effectiveDate), desc(benefitLedgerEntries.recordedAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await transaction
        .select({ count: count() })
        .from(benefitLedgerEntries)
        .where(and(...filters));
      return { items, page: input.page, pageSize: input.pageSize, total: total?.count ?? 0 };
    });
  }

  async getWorklist(principal: AuthorizationPrincipal, page: number, pageSize: number) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new InvalidBenefitAdjustmentError();
    this.requireAnyGrant(principal, 'benefits.review');
    const clientItems = await this.unitOfWork.transaction(
      { tenantId: principal.tenantId },
      async (transaction) => {
        const grants = principal.grants.filter((grant) => grant.permission === 'benefits.review');
        const tenantWide = grants.some(
          (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
        );
        const organizationIds = [
          ...new Set(
            grants
              .filter((grant) => grant.scopeType === 'organization')
              .map((grant) => grant.scopeId),
          ),
        ];
        const facilityIds = [
          ...new Set(
            grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
          ),
        ];
        if (!tenantWide && organizationIds.length === 0 && facilityIds.length === 0)
          throw new AuthorizationDeniedError('benefits.review');
        const scopeFilter = tenantWide
          ? undefined
          : or(
              ...(organizationIds.length
                ? [inArray(clientRecords.organizationId, organizationIds)]
                : []),
              ...(facilityIds.length
                ? [inArray(clientRecords.primaryFacilityId, facilityIds)]
                : []),
            );
        const filters = [
          eq(clientRecords.tenantId, principal.tenantId),
          eq(clientRecords.status, 'active'),
          ...(scopeFilter ? [scopeFilter] : []),
        ];
        const clients = await transaction
          .select()
          .from(clientRecords)
          .where(and(...filters))
          .orderBy(asc(clientRecords.lastName), asc(clientRecords.firstName))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        const [total] = await transaction
          .select({ count: count() })
          .from(clientRecords)
          .where(and(...filters));
        const ids = clients.map((client) => client.id);
        if (!ids.length) return { items: [], page, pageSize, total: total?.count ?? 0 };
        const entitlements = await transaction
          .select()
          .from(clientBenefitEntitlements)
          .where(
            and(
              eq(clientBenefitEntitlements.tenantId, principal.tenantId),
              inArray(clientBenefitEntitlements.clientId, ids),
            ),
          );
        const rules = await this.rules(transaction);
        const buckets = await transaction
          .select()
          .from(benefitAllocationBuckets)
          .where(
            and(
              eq(benefitAllocationBuckets.tenantId, principal.tenantId),
              inArray(benefitAllocationBuckets.clientId, ids),
            ),
          );
        const entries = await transaction
          .select()
          .from(benefitLedgerEntries)
          .where(
            and(
              eq(benefitLedgerEntries.tenantId, principal.tenantId),
              inArray(benefitLedgerEntries.clientId, ids),
            ),
          );
        const projectedBuckets = this.projectedBuckets(buckets, entitlements, rules, today());
        const gradeRows = await transaction
          .select({ clientId: pflegegradRecords.clientId, grade: pflegegradRecords.grade })
          .from(pflegegradRecords)
          .where(
            and(
              eq(pflegegradRecords.tenantId, principal.tenantId),
              inArray(pflegegradRecords.clientId, ids),
              eq(pflegegradRecords.status, 'confirmed'),
              lte(pflegegradRecords.validFrom, today()),
              or(isNull(pflegegradRecords.validUntil), gte(pflegegradRecords.validUntil, today())),
            ),
          )
          .orderBy(desc(pflegegradRecords.validFrom));
        const facts = entries.map(toLedgerFact);
        const todayDate = today();
        const careGradeByClient = new Map<string, number>();
        for (const row of gradeRows) {
          if (!careGradeByClient.has(row.clientId)) careGradeByClient.set(row.clientId, row.grade);
        }
        const monthly45b =
          applicableRule(rules, 'entlastungsbetrag_45b', 'DE', todayDate)?.monthlyAmountCents ?? 0;
        const expiryLimit = new Date(`${todayDate}T00:00:00.000Z`);
        expiryLimit.setUTCDate(expiryLimit.getUTCDate() + 60);
        const until = expiryLimit.toISOString().slice(0, 10);
        return {
          page,
          pageSize,
          total: total?.count ?? 0,
          items: clients.map((client) => {
            const clientEntitlements = entitlements.filter((item) => item.clientId === client.id);
            const clientBuckets = projectedBuckets.filter((item) =>
              entitlements.some(
                (entitlement) =>
                  entitlement.id === item.entitlementId && entitlement.clientId === client.id,
              ),
            );
            const careGrade = careGradeByClient.get(client.id) ?? null;
            const active45b =
              careGrade !== null &&
              clientEntitlements.some(
                (item) =>
                  item.benefitType === 'entlastungsbetrag_45b' &&
                  ['confirmed', 'provisional'].includes(item.status) &&
                  entitlementCovers(item, todayDate),
              );
            const expiringCents = clientBuckets
              .filter(
                (bucket) =>
                  bucket.benefitType === 'entlastungsbetrag_45b' &&
                  bucket.expiresAt !== null &&
                  bucket.expiresAt >= todayDate &&
                  bucket.expiresAt <= until,
              )
              .reduce(
                (sum, bucket) =>
                  addCents(sum, bucketRemainingCents(bucket, facts, todayDate, 'provisional')),
                0,
              );
            const unverifiedOpeningBalance = clientBuckets.some(
              (bucket) =>
                ['opening_balance', 'external_input'].includes(bucket.bucketType) &&
                bucket.verificationStatus !== 'payer_confirmed',
            );
            const recordedRemainingCents = projectedBuckets
              .filter(
                (bucket) =>
                  bucket.entitlementId !== null &&
                  entitlements.some(
                    (entitlement) =>
                      entitlement.id === bucket.entitlementId && entitlement.clientId === client.id,
                  ),
              )
              .filter((bucket) => bucket.benefitType === 'entlastungsbetrag_45b')
              .reduce(
                (sum, bucket) =>
                  addCents(sum, bucketRemainingCents(bucket, facts, todayDate, 'provisional')),
                0,
              );
            return {
              clientId: client.id,
              clientName: `${client.preferredName ?? client.firstName} ${client.lastName}`,
              organizationId: client.organizationId,
              facilityId: client.primaryFacilityId,
              careGrade,
              missingPflegegrad: careGrade === null,
              missingEntitlement: !active45b,
              lowRecordedBalance:
                active45b && monthly45b > 0 && recordedRemainingCents < monthly45b,
              recordedRemainingCents,
              expiringCarryoverCents: expiringCents,
              unverifiedOpeningBalance,
            };
          }),
        };
      },
    );
    const unallocatedServices = await this.listUnallocatedServices(
      principal,
      undefined,
      page,
      pageSize,
    );
    return { clients: clientItems, unallocatedServices };
  }

  async createFundingSource(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: FundingSourceInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.manage');
      if (!validSourceInput(input)) throw new InvalidBenefitFundingSourceError();
      let insuranceId: string | null = input.clientInsuranceId ?? null;
      if (
        input.sourceType === 'statutory_long_term_care_insurance' ||
        input.sourceType === 'private_long_term_care_insurance'
      ) {
        if (!insuranceId) throw new InvalidBenefitFundingSourceError();
        const [insurance] = await transaction
          .select()
          .from(clientInsurances)
          .where(
            and(
              eq(clientInsurances.tenantId, principal.tenantId),
              eq(clientInsurances.clientId, clientId),
              eq(clientInsurances.id, insuranceId),
            ),
          )
          .limit(1);
        if (
          !insurance ||
          (input.sourceType === 'statutory_long_term_care_insurance' &&
            insurance.insuranceType !== 'pflegeversicherung') ||
          (input.sourceType === 'private_long_term_care_insurance' &&
            insurance.insuranceType !== 'private')
        ) {
          throw new InvalidBenefitFundingSourceError();
        }
      } else if (insuranceId !== null) {
        throw new InvalidBenefitFundingSourceError();
      }
      const id = uuidv7();
      const [source] = await transaction
        .insert(benefitFundingSources)
        .values({
          id,
          tenantId: principal.tenantId,
          clientId,
          sourceType: input.sourceType,
          clientInsuranceId: insuranceId,
          label: cleanOptional(input.label),
          status: 'active',
          createdBy: principal.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!source) throw new Error('Funding source insert returned no row');
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action: 'benefit.funding_source_created',
        resourceType: 'client',
        resourceId: clientId,
        metadata: { fundingSourceId: id, sourceType: input.sourceType },
        eventType: 'benefit.funding_source_created',
        aggregateId: clientId,
        payload: { fundingSourceId: id, clientId, sourceType: input.sourceType },
      });
      return source;
    });
  }

  async createEntitlement(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: EntitlementInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    assertEntitlementInput(input);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.manage');
      await transaction
        .select({ id: clientRecords.id })
        .from(clientRecords)
        .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
        .for('update')
        .limit(1);
      if (isStatutoryBenefit(input.benefitType)) {
        const [overlap] = await transaction
          .select({ id: clientBenefitEntitlements.id })
          .from(clientBenefitEntitlements)
          .where(
            and(
              eq(clientBenefitEntitlements.tenantId, principal.tenantId),
              eq(clientBenefitEntitlements.clientId, clientId),
              eq(clientBenefitEntitlements.benefitType, input.benefitType),
              inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional', 'suspended']),
              lte(clientBenefitEntitlements.validFrom, input.validUntil ?? '9999-12-31'),
              or(
                isNull(clientBenefitEntitlements.validUntil),
                gte(clientBenefitEntitlements.validUntil, input.validFrom),
              ),
            ),
          )
          .limit(1);
        if (overlap) throw new BenefitEntitlementPeriodConflictError();
      }
      const source = await this.requireFundingSource(
        transaction,
        principal.tenantId,
        clientId,
        input.fundingSourceId,
      );
      if (
        source.status !== 'active' ||
        !sourceMatchesBenefit(source.sourceType, input.benefitType)
      ) {
        throw new InvalidBenefitEntitlementError();
      }
      if (
        input.benefitType === 'entlastungsbetrag_45b' ||
        input.benefitType === 'umwandlungsanspruch_45a_4'
      ) {
        const rules = await this.rules(transaction);
        if (!applicableRule(rules, input.benefitType, 'DE', input.validFrom))
          throw new InvalidBenefitEntitlementError();
      }
      const id = uuidv7();
      const [entitlement] = await transaction
        .insert(clientBenefitEntitlements)
        .values({
          id,
          tenantId: principal.tenantId,
          clientId,
          benefitType: input.benefitType,
          fundingSourceId: input.fundingSourceId,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          status: input.status,
          calculationMode: input.calculationMode,
          source: input.source,
          verifiedAt: input.status === 'confirmed' ? now : null,
          version: 1,
          createdBy: principal.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entitlement) throw new Error('Benefit entitlement insert returned no row');
      const rules = await this.rules(transaction);
      await this.ensureMonthlyAllocations(
        transaction,
        principal,
        entitlement,
        rules,
        today(),
        context,
        auditContext,
      );
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action: 'benefit.entitlement_created',
        resourceType: 'client',
        resourceId: clientId,
        metadata: { entitlementId: id, benefitType: input.benefitType, source: input.source },
        eventType: 'benefit.entitlement_created',
        aggregateId: clientId,
        payload: { entitlementId: id, clientId, benefitType: input.benefitType, version: 1 },
      });
      return toEntitlementResponse(entitlement);
    });
  }

  async updateEntitlement(
    principal: AuthorizationPrincipal,
    clientId: string,
    entitlementId: string,
    input: {
      expectedVersion: number;
      status?: 'confirmed' | 'provisional' | 'suspended' | 'ended';
      validUntil?: string | null;
      source?: EntitlementInput['source'];
    },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      (input.validUntil !== undefined && input.validUntil !== null && !isDate(input.validUntil))
    )
      throw new InvalidBenefitEntitlementError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.manage');
      await transaction
        .select({ id: clientRecords.id })
        .from(clientRecords)
        .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
        .for('update')
        .limit(1);
      const [current] = await transaction
        .select()
        .from(clientBenefitEntitlements)
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, principal.tenantId),
            eq(clientBenefitEntitlements.clientId, clientId),
            eq(clientBenefitEntitlements.id, entitlementId),
          ),
        )
        .for('update')
        .limit(1);
      if (!current) throw new BenefitEntitlementNotFoundError();
      if (current.version !== input.expectedVersion)
        throw new BenefitEntitlementVersionConflictError();
      const validUntil =
        input.validUntil === undefined
          ? input.status === 'ended' && current.status !== 'ended'
            ? today()
            : current.validUntil
          : input.validUntil;
      if (validUntil !== null && validUntil < current.validFrom)
        throw new InvalidBenefitEntitlementError();
      const status = input.status ?? current.status;
      const sourceName = input.source ?? current.source;
      if (status === 'ended' && validUntil !== null && validUntil > today())
        throw new InvalidBenefitEntitlementError();
      if (status === 'confirmed' && !confirmedEntitlementAllowed(current.benefitType, sourceName))
        throw new InvalidBenefitEntitlementError();
      if (
        isStatutoryBenefit(current.benefitType) &&
        ['confirmed', 'provisional'].includes(status)
      ) {
        const [overlap] = await transaction
          .select({ id: clientBenefitEntitlements.id })
          .from(clientBenefitEntitlements)
          .where(
            and(
              eq(clientBenefitEntitlements.tenantId, principal.tenantId),
              eq(clientBenefitEntitlements.clientId, clientId),
              eq(clientBenefitEntitlements.benefitType, current.benefitType),
              ne(clientBenefitEntitlements.id, entitlementId),
              inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional', 'suspended']),
              lte(clientBenefitEntitlements.validFrom, validUntil ?? '9999-12-31'),
              or(
                isNull(clientBenefitEntitlements.validUntil),
                gte(clientBenefitEntitlements.validUntil, current.validFrom),
              ),
            ),
          )
          .limit(1);
        if (overlap) throw new BenefitEntitlementPeriodConflictError();
      }
      const [updated] = await transaction
        .update(clientBenefitEntitlements)
        .set({
          status,
          validUntil,
          source: sourceName,
          verifiedAt: status === 'confirmed' ? (current.verifiedAt ?? now) : null,
          version: current.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, principal.tenantId),
            eq(clientBenefitEntitlements.id, entitlementId),
            eq(clientBenefitEntitlements.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new InvalidBenefitEntitlementError();
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action: 'benefit.entitlement_updated',
        resourceType: 'client',
        resourceId: clientId,
        metadata: {
          entitlementId,
          version: updated.version,
          changedFields: ['status', 'validUntil', 'source'],
        },
        eventType: 'benefit.entitlement_updated',
        aggregateId: clientId,
        payload: {
          entitlementId,
          clientId,
          benefitType: updated.benefitType,
          version: updated.version,
        },
      });
      return toEntitlementResponse(updated);
    });
  }

  async recordAdjustment(
    principal: AuthorizationPrincipal,
    clientId: string,
    input: BenefitAdjustmentInput,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    assertAdjustmentInput(input);
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      await this.requireClient(transaction, principal, clientId, 'benefits.adjust');
      await transaction
        .select({ id: clientRecords.id })
        .from(clientRecords)
        .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
        .for('update')
        .limit(1);
      const sourceReferenceKey = `adjustment:${input.idempotencyKey}:`;
      const priorEntries = await transaction
        .select()
        .from(benefitLedgerEntries)
        .where(
          and(
            eq(benefitLedgerEntries.tenantId, principal.tenantId),
            like(benefitLedgerEntries.sourceReference, `${sourceReferenceKey}%`),
          ),
        )
        .orderBy(asc(benefitLedgerEntries.sourceReference));
      if (priorEntries.length) {
        const amountCents = priorEntries.reduce(
          (sum, entry) => addCents(sum, entry.amountCents),
          0,
        );
        const expectedEntryType =
          input.adjustmentType === 'opening_balance'
            ? 'opening_balance_adjusted'
            : input.adjustmentType === 'external_consumption'
              ? 'external_consumption_recorded'
              : 'manual_adjustment';
        if (
          amountCents !== input.amountCents ||
          priorEntries.some(
            (entry) =>
              entry.clientId !== clientId ||
              entry.fundingSourceId !== input.fundingSourceId ||
              entry.effectiveDate !== input.effectiveDate ||
              entry.entryType !== expectedEntryType ||
              entry.sourceType !== input.sourceType ||
              entry.reference !== cleanOptional(input.reference) ||
              entry.verificationStatus !== input.verificationStatus ||
              !entry.sourceReference.startsWith(`${sourceReferenceKey}${input.benefitType}:`),
          )
        )
          throw new BenefitAdjustmentConflictError();
        const [bucket] = await transaction
          .select({
            id: benefitAllocationBuckets.id,
            bucketType: benefitAllocationBuckets.bucketType,
          })
          .from(benefitAllocationBuckets)
          .where(
            and(
              eq(benefitAllocationBuckets.tenantId, principal.tenantId),
              eq(
                benefitAllocationBuckets.sourceReference,
                `${sourceReferenceKey}${input.benefitType}`,
              ),
            ),
          )
          .limit(1);
        const expectedBucketType =
          input.adjustmentType === 'opening_balance'
            ? 'opening_balance'
            : input.adjustmentType === 'external_input'
              ? 'external_input'
              : 'manual_adjustment';
        if (
          input.amountCents > 0 !== Boolean(bucket) ||
          (bucket && bucket.bucketType !== expectedBucketType)
        ) {
          throw new BenefitAdjustmentConflictError();
        }
        return {
          id: priorEntries[0]!.id,
          bucketId: bucket?.id ?? null,
          amountCents,
          effectiveDate: input.effectiveDate,
          verificationStatus: input.verificationStatus,
        };
      }
      await this.requireFundingSource(
        transaction,
        principal.tenantId,
        clientId,
        input.fundingSourceId,
      );
      const selectedEntitlement = input.entitlementId
        ? await this.requireEntitlement(
            transaction,
            principal.tenantId,
            clientId,
            input.entitlementId,
          )
        : await this.findActiveEntitlement(
            transaction,
            principal.tenantId,
            clientId,
            input.fundingSourceId,
            input.benefitType,
            input.effectiveDate,
          );
      const entitlement = selectedEntitlement
        ? await this.lockEntitlement(
            transaction,
            principal.tenantId,
            clientId,
            selectedEntitlement.id,
          )
        : null;
      if (
        !entitlement ||
        entitlement.fundingSourceId !== input.fundingSourceId ||
        entitlement.benefitType !== input.benefitType ||
        !entitlementCovers(entitlement, input.effectiveDate)
      )
        throw new InvalidBenefitAdjustmentError();
      const adjustmentId = uuidv7();
      const positive = input.amountCents > 0;
      if (
        (input.adjustmentType === 'opening_balance' || input.adjustmentType === 'external_input') &&
        !positive
      )
        throw new InvalidBenefitAdjustmentError();
      if (input.adjustmentType === 'external_consumption' && positive)
        throw new InvalidBenefitAdjustmentError();
      if (!positive) {
        const rules = await this.rules(transaction);
        await this.ensureMonthlyAllocations(
          transaction,
          principal,
          entitlement,
          rules,
          input.effectiveDate,
          context,
          auditContext,
        );
      }
      const entryType =
        input.adjustmentType === 'opening_balance'
          ? 'opening_balance_adjusted'
          : input.adjustmentType === 'external_consumption'
            ? 'external_consumption_recorded'
            : 'manual_adjustment';
      let bucketId: string | null = null;
      let bucketUses: Array<{ id: string; amountCents: number }> = [];
      try {
        if (positive) {
          bucketId = uuidv7();
          await transaction.insert(benefitAllocationBuckets).values({
            id: bucketId,
            tenantId: principal.tenantId,
            clientId,
            fundingSourceId: input.fundingSourceId,
            entitlementId: entitlement.id,
            benefitType: input.benefitType,
            originPeriod: monthStart(input.effectiveDate),
            amountCents: input.amountCents,
            expiresAt: bucketExpiry(input.benefitType, input.effectiveDate),
            bucketType:
              input.adjustmentType === 'opening_balance'
                ? 'opening_balance'
                : input.adjustmentType === 'external_input'
                  ? 'external_input'
                  : 'manual_adjustment',
            verificationStatus: input.verificationStatus,
            sourceReference: `${sourceReferenceKey}${input.benefitType}`,
            createdBy: principal.userId,
            createdAt: now,
          });
        } else {
          const buckets = await this.listBuckets(
            transaction,
            principal.tenantId,
            clientId,
            input.fundingSourceId,
            input.benefitType,
            entitlement.id,
          );
          const entries = await this.listLedger(transaction, principal.tenantId, clientId);
          const result = allocateFromBuckets({
            buckets: buckets.map(toBucket),
            ledger: entries.map(toLedgerFact),
            amountCents: -input.amountCents,
            serviceDate: input.effectiveDate,
            verification:
              input.verificationStatus === 'payer_confirmed' ? 'confirmed' : 'provisional',
          });
          if (result.remainingCents > 0)
            throw new BenefitBudgetInsufficientError(result.remainingCents);
          bucketUses = result.uses.map((use) => ({
            id: use.bucketId,
            amountCents: use.amountCents,
          }));
        }
        const rows = positive
          ? [{ bucketId, amountCents: input.amountCents }]
          : bucketUses.map((use) => ({ bucketId: use.id, amountCents: -use.amountCents }));
        for (const [index, row] of rows.entries()) {
          await transaction.insert(benefitLedgerEntries).values({
            id: index === 0 ? adjustmentId : uuidv7(),
            tenantId: principal.tenantId,
            clientId,
            fundingSourceId: input.fundingSourceId,
            allocationBucketId: row.bucketId,
            serviceAllocationId: null,
            performedServiceId: null,
            entryType,
            amountCents: row.amountCents,
            effectiveDate: input.effectiveDate,
            sourceType: input.sourceType,
            reference: cleanOptional(input.reference),
            sourceReference: `${sourceReferenceKey}${input.benefitType}:${index}`,
            verificationStatus: input.verificationStatus,
            recordedBy: principal.userId,
            recordedAt: now,
          });
        }
      } catch (error) {
        if (
          hasConstraint(error, 'benefit_allocation_buckets_source_uq') ||
          hasConstraint(error, 'benefit_ledger_entries_source_reference_uq')
        )
          throw new BenefitAdjustmentConflictError();
        throw error;
      }
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action:
          input.adjustmentType === 'opening_balance'
            ? 'benefit.opening_balance_recorded'
            : 'benefit.adjustment_recorded',
        resourceType: 'client',
        resourceId: clientId,
        metadata: {
          adjustmentId,
          fundingSourceId: input.fundingSourceId,
          benefitType: input.benefitType,
          amountCents: input.amountCents,
          effectiveDate: input.effectiveDate,
          verificationStatus: input.verificationStatus,
          reference: cleanOptional(input.reference),
        },
        eventType:
          input.adjustmentType === 'opening_balance'
            ? 'benefit.opening_balance_recorded'
            : 'benefit.adjustment_recorded',
        aggregateId: clientId,
        payload:
          input.adjustmentType === 'opening_balance'
            ? {
                ledgerEntryId: adjustmentId,
                clientId,
                fundingSourceId: input.fundingSourceId,
                amountCents: input.amountCents,
                verificationStatus: input.verificationStatus,
              }
            : { ledgerEntryId: adjustmentId, clientId, amountCents: input.amountCents, entryType },
      });
      return {
        id: adjustmentId,
        bucketId,
        amountCents: input.amountCents,
        effectiveDate: input.effectiveDate,
        verificationStatus: input.verificationStatus,
      };
    });
  }

  async listUnallocatedServices(
    principal: AuthorizationPrincipal,
    clientId?: string,
    page = 1,
    pageSize = 25,
  ) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new InvalidBenefitAdjustmentError();
    this.requireAnyGrant(principal, 'benefits.review');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select({
          performed: performedServices,
          execution: visitExecutions,
          visit: visits,
          service: serviceDefinitions,
          client: clientRecords,
        })
        .from(performedServices)
        .innerJoin(
          visitExecutions,
          and(
            eq(visitExecutions.tenantId, performedServices.tenantId),
            eq(visitExecutions.id, performedServices.executionId),
          ),
        )
        .innerJoin(
          visits,
          and(
            eq(visits.tenantId, performedServices.tenantId),
            eq(visits.id, performedServices.visitId),
          ),
        )
        .innerJoin(
          serviceDefinitions,
          and(
            eq(serviceDefinitions.tenantId, performedServices.tenantId),
            eq(serviceDefinitions.id, performedServices.serviceDefinitionId),
          ),
        )
        .innerJoin(
          clientRecords,
          and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
        )
        .where(
          and(
            eq(performedServices.tenantId, principal.tenantId),
            eq(visitExecutions.status, 'completed'),
            ne(performedServices.status, 'not_performed'),
            ...(clientId ? [eq(visits.clientId, clientId)] : []),
          ),
        )
        .orderBy(desc(visitExecutions.actualEnd), asc(performedServices.id))
        .limit(500);
      const visible = rows.filter(({ client }) =>
        can(principal, {
          action: 'benefits.review',
          resource: {
            tenantId: principal.tenantId,
            clientId: client.id,
            ...(client.organizationId ? { organizationId: client.organizationId } : {}),
            ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
          },
        }),
      );
      const selected = visible.slice((page - 1) * pageSize, page * pageSize);
      const items = [];
      for (const row of selected) {
        const allocations = await transaction
          .select({
            id: serviceAllocations.id,
            amountCents: serviceAllocations.amountCents,
            serviceAmountCents: serviceAllocations.serviceAmountCents,
          })
          .from(serviceAllocations)
          .leftJoin(
            serviceAllocationReversals,
            and(
              eq(serviceAllocationReversals.tenantId, serviceAllocations.tenantId),
              eq(serviceAllocationReversals.allocationId, serviceAllocations.id),
            ),
          )
          .where(
            and(
              eq(serviceAllocations.tenantId, principal.tenantId),
              eq(serviceAllocations.performedServiceId, row.performed.id),
              isNull(serviceAllocationReversals.id),
            ),
          );
        const price = await this.effectivePrice(
          transaction,
          principal.tenantId,
          row.performed.serviceDefinitionId,
          row.visit.organizationId,
          row.visit.facilityId,
          serviceDate(row.execution.actualEnd ?? row.visit.plannedStart, row.visit.timezone),
        );
        const qty = row.performed.actualQuantity;
        let serviceAmountCents: number | null = null;
        if (price && qty) {
          try {
            serviceAmountCents = calculateServicePriceCents(
              price.priceCents,
              price.pricingUnit,
              row.performed.unitSnapshot,
              qty,
            );
          } catch {
            serviceAmountCents = null;
          }
        }
        const allocatedCents = allocations.reduce(
          (sum, allocation) => addCents(sum, allocation.amountCents),
          0,
        );
        if (serviceAmountCents !== null && allocatedCents >= serviceAmountCents) continue;
        items.push({
          performedServiceId: row.performed.id,
          clientId: row.client.id,
          clientName: `${row.client.preferredName ?? row.client.firstName} ${row.client.lastName}`,
          organizationId: row.visit.organizationId,
          facilityId: row.visit.facilityId,
          serviceName: row.performed.serviceNameSnapshot,
          serviceCategory: row.service.benefitCategory,
          serviceDate: serviceDate(
            row.execution.actualEnd ?? row.visit.plannedStart,
            row.visit.timezone,
          ),
          unit: row.performed.unitSnapshot,
          actualQuantity: qty,
          priceId: price?.id ?? null,
          priceCents: price?.priceCents ?? null,
          pricingUnit: price?.pricingUnit ?? null,
          serviceAmountCents,
          allocatedCents,
          remainingCents:
            serviceAmountCents === null ? null : Math.max(0, serviceAmountCents - allocatedCents),
        });
      }
      return { items, page, pageSize, total: visible.length };
    });
  }

  async allocateService(
    principal: AuthorizationPrincipal,
    performedServiceId: string,
    inputs: readonly ServiceAllocationInput[],
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!inputs.length || inputs.length > 8 || inputs.some((input) => !validAllocationInput(input)))
      throw new InvalidBenefitAdjustmentError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [lockedPerformedService] = await transaction
        .select()
        .from(performedServices)
        .where(
          and(
            eq(performedServices.tenantId, principal.tenantId),
            eq(performedServices.id, performedServiceId),
          ),
        )
        .for('update')
        .limit(1);
      if (!lockedPerformedService) throw new BenefitAllocationNotFoundError();
      const [record] = await transaction
        .select({
          performed: performedServices,
          execution: visitExecutions,
          visit: visits,
          service: serviceDefinitions,
          client: clientRecords,
        })
        .from(performedServices)
        .innerJoin(
          visitExecutions,
          and(
            eq(visitExecutions.tenantId, performedServices.tenantId),
            eq(visitExecutions.id, performedServices.executionId),
          ),
        )
        .innerJoin(
          visits,
          and(
            eq(visits.tenantId, performedServices.tenantId),
            eq(visits.id, performedServices.visitId),
          ),
        )
        .innerJoin(
          serviceDefinitions,
          and(
            eq(serviceDefinitions.tenantId, performedServices.tenantId),
            eq(serviceDefinitions.id, performedServices.serviceDefinitionId),
          ),
        )
        .innerJoin(
          clientRecords,
          and(eq(clientRecords.tenantId, visits.tenantId), eq(clientRecords.id, visits.clientId)),
        )
        .where(
          and(
            eq(performedServices.tenantId, principal.tenantId),
            eq(performedServices.id, performedServiceId),
          ),
        )
        .limit(1);
      if (
        !record ||
        record.execution.status !== 'completed' ||
        record.performed.status === 'not_performed'
      )
        throw new BenefitAllocationNotFoundError();
      const client = await this.requireClient(
        transaction,
        principal,
        record.client.id,
        'benefits.allocate',
      );
      const effectiveDate = serviceDate(
        record.execution.actualEnd ?? record.visit.plannedStart,
        record.visit.timezone,
      );
      const lockedEntitlements = new Map<string, typeof clientBenefitEntitlements.$inferSelect>();
      for (const entitlementId of [...new Set(inputs.map((input) => input.entitlementId))].sort()) {
        lockedEntitlements.set(
          entitlementId,
          await this.lockEntitlement(transaction, principal.tenantId, client.id, entitlementId),
        );
      }
      const idempotencyKeys = inputs.map((input) => input.idempotencyKey);
      if (new Set(idempotencyKeys).size !== idempotencyKeys.length) {
        throw new BenefitAllocationConflictError();
      }
      const existingAllocations = await transaction
        .select()
        .from(serviceAllocations)
        .where(
          and(
            eq(serviceAllocations.tenantId, principal.tenantId),
            inArray(serviceAllocations.idempotencyKey, idempotencyKeys),
          ),
        );
      if (existingAllocations.length) {
        if (existingAllocations.length !== inputs.length)
          throw new BenefitAllocationConflictError();
        const matched = inputs.map((input) =>
          existingAllocations.find(
            (allocation) => allocation.idempotencyKey === input.idempotencyKey,
          ),
        );
        if (
          matched.some((allocation, index) => {
            const input = inputs[index]!;
            return (
              !allocation ||
              allocation.performedServiceId !== performedServiceId ||
              allocation.fundingSourceId !== input.fundingSourceId ||
              allocation.entitlementId !== input.entitlementId ||
              allocation.amountCents !== input.amountCents ||
              allocation.status !== input.status
            );
          })
        )
          throw new BenefitAllocationConflictError();
        const existingIds = existingAllocations.map((allocation) => allocation.id);
        const [reversal] = await transaction
          .select({ id: serviceAllocationReversals.id })
          .from(serviceAllocationReversals)
          .where(
            and(
              eq(serviceAllocationReversals.tenantId, principal.tenantId),
              inArray(serviceAllocationReversals.allocationId, existingIds),
            ),
          )
          .limit(1);
        if (reversal) throw new BenefitAllocationAlreadyReversedError();
        const activeRows = await transaction
          .select({ amountCents: serviceAllocations.amountCents })
          .from(serviceAllocations)
          .leftJoin(
            serviceAllocationReversals,
            and(
              eq(serviceAllocationReversals.tenantId, serviceAllocations.tenantId),
              eq(serviceAllocationReversals.allocationId, serviceAllocations.id),
            ),
          )
          .where(
            and(
              eq(serviceAllocations.tenantId, principal.tenantId),
              eq(serviceAllocations.performedServiceId, performedServiceId),
              isNull(serviceAllocationReversals.id),
            ),
          );
        const allocatedCents = existingAllocations.reduce(
          (sum, allocation) => addCents(sum, allocation.amountCents),
          0,
        );
        const previouslyAllocatedCents =
          activeRows.reduce((sum, allocation) => addCents(sum, allocation.amountCents), 0) -
          allocatedCents;
        const serviceAmountCents = existingAllocations[0]!.serviceAmountCents;
        if (
          existingAllocations.some(
            (allocation) => allocation.serviceAmountCents !== serviceAmountCents,
          )
        ) {
          throw new BenefitAllocationConflictError();
        }
        return {
          performedServiceId,
          serviceAmountCents,
          previouslyAllocatedCents,
          allocatedCents,
          remainingCents: serviceAmountCents - previouslyAllocatedCents - allocatedCents,
          allocations: existingAllocations.map((allocation) => ({
            id: allocation.id,
            amountCents: allocation.amountCents,
            status: allocation.status,
            benefitType: lockedEntitlements.get(allocation.entitlementId!)?.benefitType ?? 'other',
          })),
        };
      }
      const price = await this.effectivePrice(
        transaction,
        principal.tenantId,
        record.performed.serviceDefinitionId,
        record.visit.organizationId,
        record.visit.facilityId,
        effectiveDate,
      );
      const quantity = record.performed.actualQuantity;
      let serviceAmountCents = 0;
      if (price && quantity)
        serviceAmountCents = calculateServicePriceCents(
          price.priceCents,
          price.pricingUnit,
          record.performed.unitSnapshot,
          quantity,
        );
      const manualAmounts = [
        ...new Set(
          inputs.flatMap((input) =>
            input.manualServiceAmountCents === undefined ? [] : [input.manualServiceAmountCents],
          ),
        ),
      ];
      if (manualAmounts.length > 1) throw new InvalidBenefitAdjustmentError();
      if (inputs.some((input) => input.manualServiceAmountCents !== undefined)) {
        const manual = inputs.find(
          (input) => input.manualServiceAmountCents !== undefined,
        )?.manualServiceAmountCents;
        if (
          !Number.isSafeInteger(manual) ||
          manual! <= 0 ||
          (serviceAmountCents > 0 && manual !== serviceAmountCents)
        )
          throw new InvalidBenefitAdjustmentError();
        serviceAmountCents = manual!;
      }
      if (
        !Number.isSafeInteger(serviceAmountCents) ||
        serviceAmountCents <= 0 ||
        serviceAmountCents > 2_000_000_000
      ) {
        throw new BenefitAllocationConflictError();
      }
      const priorRows = await transaction
        .select({ id: serviceAllocations.id, amountCents: serviceAllocations.amountCents })
        .from(serviceAllocations)
        .leftJoin(
          serviceAllocationReversals,
          and(
            eq(serviceAllocationReversals.tenantId, serviceAllocations.tenantId),
            eq(serviceAllocationReversals.allocationId, serviceAllocations.id),
          ),
        )
        .where(
          and(
            eq(serviceAllocations.tenantId, principal.tenantId),
            eq(serviceAllocations.performedServiceId, performedServiceId),
            isNull(serviceAllocationReversals.id),
          ),
        );
      const allocatedBefore = priorRows.reduce((sum, row) => addCents(sum, row.amountCents), 0);
      const totalRequested = inputs.reduce((sum, input) => addCents(sum, input.amountCents), 0);
      if (allocatedBefore + totalRequested > serviceAmountCents)
        throw new BenefitAllocationConflictError();
      const rules = await this.rules(transaction);
      const created = [];
      const createAllocationRow = async (values: typeof serviceAllocations.$inferInsert) => {
        try {
          await transaction.insert(serviceAllocations).values(values);
        } catch (error) {
          if (hasConstraint(error, 'service_allocations_idempotency_uq')) {
            throw new BenefitAllocationConflictError();
          }
          throw error;
        }
      };
      for (const input of inputs) {
        const source = await this.requireFundingSource(
          transaction,
          principal.tenantId,
          client.id,
          input.fundingSourceId,
        );
        if (source.status !== 'active') throw new InvalidBenefitFundingSourceError();
        const entitlement = lockedEntitlements.get(input.entitlementId);
        if (!entitlement) throw new BenefitEntitlementNotFoundError();
        if (
          entitlement.fundingSourceId !== source.id ||
          !entitlementCovers(entitlement, effectiveDate) ||
          (entitlement.status !== 'confirmed' && entitlement.status !== 'provisional')
        )
          throw new BenefitEntitlementNotFoundError();
        if (!sourceMatchesBenefit(source.sourceType, entitlement.benefitType))
          throw new InvalidBenefitEntitlementError();
        if (entitlement.benefitType !== 'private' && entitlement.benefitType !== 'other') {
          await this.ensureMonthlyAllocations(
            transaction,
            principal,
            entitlement,
            rules,
            effectiveDate,
            context,
            auditContext,
          );
          const grade = await this.careGradeAt(
            transaction,
            principal.tenantId,
            client.id,
            effectiveDate,
          );
          const rule = applicableRule(rules, entitlement.benefitType, 'DE', effectiveDate);
          const recognition = await this.isRecognized(
            transaction,
            principal.tenantId,
            record.visit.organizationId,
            'DE-NW',
            effectiveDate,
          );
          const externalInputExists =
            entitlement.benefitType !== 'umwandlungsanspruch_45a_4' ||
            (
              await this.listBuckets(
                transaction,
                principal.tenantId,
                client.id,
                source.id,
                entitlement.benefitType,
                entitlement.id,
              )
            ).some((bucket) => bucket.bucketType === 'external_input');
          const eligibility = serviceBenefitEligibility({
            benefitType: entitlement.benefitType,
            serviceCategory: record.service.benefitCategory,
            jurisdiction: 'DE-NW',
            serviceDate: effectiveDate,
            careGrade: grade,
            rule,
            recognized: recognition,
            externalInputRecorded: externalInputExists,
          });
          if (!eligibility.eligible) {
            if (eligibility.reason === 'PROVIDER_RECOGNITION_REQUIRED')
              throw new BenefitProviderRecognitionRequiredError();
            throw new BenefitServiceNotEligibleError(eligibility.reason ?? 'SERVICE_NOT_ELIGIBLE');
          }
          const buckets = await this.listBuckets(
            transaction,
            principal.tenantId,
            client.id,
            source.id,
            entitlement.benefitType,
            entitlement.id,
          );
          const ledger = await this.listLedger(transaction, principal.tenantId, client.id);
          const available = allocateFromBuckets({
            buckets: buckets.map(toBucket),
            ledger: ledger.map(toLedgerFact),
            amountCents: input.amountCents,
            serviceDate: effectiveDate,
            verification: input.status,
          });
          if (available.remainingCents > 0)
            throw new BenefitBudgetInsufficientError(available.remainingCents);
          const allocationId = uuidv7();
          await createAllocationRow({
            id: allocationId,
            tenantId: principal.tenantId,
            clientId: client.id,
            performedServiceId,
            fundingSourceId: source.id,
            entitlementId: entitlement.id,
            servicePriceId: price?.id ?? null,
            idempotencyKey: input.idempotencyKey,
            serviceAmountCents,
            amountCents: input.amountCents,
            priceCentsSnapshot: price?.priceCents ?? null,
            pricingUnitSnapshot: price?.pricingUnit ?? null,
            actualQuantitySnapshot: quantity,
            status: input.status,
            recordedBy: principal.userId,
            recordedAt: now,
          });
          for (const [index, use] of available.uses.entries()) {
            await transaction.insert(benefitLedgerEntries).values({
              id: uuidv7(),
              tenantId: principal.tenantId,
              clientId: client.id,
              fundingSourceId: source.id,
              allocationBucketId: use.bucketId,
              serviceAllocationId: allocationId,
              performedServiceId,
              entryType: 'service_consumption_allocated',
              amountCents: -use.amountCents,
              effectiveDate,
              sourceType: 'performed_service',
              reference: performedServiceId,
              sourceReference: `service-allocation:${allocationId}:${index}`,
              verificationStatus: 'provider_reported',
              recordedBy: principal.userId,
              recordedAt: now,
            });
          }
          created.push({
            id: allocationId,
            amountCents: input.amountCents,
            status: input.status,
            benefitType: entitlement.benefitType,
          });
        } else {
          const allocationId = uuidv7();
          await createAllocationRow({
            id: allocationId,
            tenantId: principal.tenantId,
            clientId: client.id,
            performedServiceId,
            fundingSourceId: source.id,
            entitlementId: entitlement.id,
            servicePriceId: price?.id ?? null,
            idempotencyKey: input.idempotencyKey,
            serviceAmountCents,
            amountCents: input.amountCents,
            priceCentsSnapshot: price?.priceCents ?? null,
            pricingUnitSnapshot: price?.pricingUnit ?? null,
            actualQuantitySnapshot: quantity,
            status: input.status,
            recordedBy: principal.userId,
            recordedAt: now,
          });
          await transaction.insert(benefitLedgerEntries).values({
            id: uuidv7(),
            tenantId: principal.tenantId,
            clientId: client.id,
            fundingSourceId: source.id,
            allocationBucketId: null,
            serviceAllocationId: allocationId,
            performedServiceId,
            entryType: 'service_consumption_allocated',
            amountCents: -input.amountCents,
            effectiveDate,
            sourceType: 'performed_service',
            reference: performedServiceId,
            sourceReference: `service-allocation:${allocationId}:0`,
            verificationStatus: 'provider_reported',
            recordedBy: principal.userId,
            recordedAt: now,
          });
          created.push({
            id: allocationId,
            amountCents: input.amountCents,
            status: input.status,
            benefitType: entitlement.benefitType,
          });
        }
      }
      const total = created.reduce((sum, item) => addCents(sum, item.amountCents), 0);
      for (const allocation of created) {
        await this.record({
          transaction,
          principal,
          context,
          auditContext,
          action: 'benefit.service_allocated',
          resourceType: 'performed_service',
          resourceId: performedServiceId,
          metadata: {
            allocationId: allocation.id,
            clientId: client.id,
            amountCents: allocation.amountCents,
            status: allocation.status,
            benefitType: allocation.benefitType,
          },
          eventType: 'benefit.service_allocated',
          aggregateId: performedServiceId,
          payload: {
            allocationId: allocation.id,
            performedServiceId,
            clientId: client.id,
            amountCents: allocation.amountCents,
            status: allocation.status,
          },
        });
      }
      return {
        performedServiceId,
        serviceAmountCents,
        previouslyAllocatedCents: allocatedBefore,
        allocatedCents: total,
        remainingCents: serviceAmountCents - allocatedBefore - total,
        allocations: created,
      };
    });
  }

  async reverseAllocation(
    principal: AuthorizationPrincipal,
    allocationId: string,
    input: { reason: string; idempotencyKey: string },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (!input.reason.trim() || input.reason.trim().length > 500 || !isUuid(input.idempotencyKey))
      throw new InvalidBenefitAdjustmentError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [allocation] = await transaction
        .select()
        .from(serviceAllocations)
        .where(
          and(
            eq(serviceAllocations.tenantId, principal.tenantId),
            eq(serviceAllocations.id, allocationId),
          ),
        )
        .for('update')
        .limit(1);
      if (!allocation) throw new BenefitAllocationNotFoundError();
      await this.requireClient(transaction, principal, allocation.clientId, 'benefits.allocate');
      const [existing] = await transaction
        .select({
          id: serviceAllocationReversals.id,
          idempotencyKey: serviceAllocationReversals.idempotencyKey,
          reason: serviceAllocationReversals.reason,
          reversedAt: serviceAllocationReversals.reversedAt,
        })
        .from(serviceAllocationReversals)
        .where(
          and(
            eq(serviceAllocationReversals.tenantId, principal.tenantId),
            eq(serviceAllocationReversals.allocationId, allocationId),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.idempotencyKey === input.idempotencyKey &&
          existing.reason === input.reason.trim()
        ) {
          return { allocationId, reversalId: existing.id, reversedAt: existing.reversedAt };
        }
        throw new BenefitAllocationAlreadyReversedError();
      }
      const [keyUse] = await transaction
        .select({ allocationId: serviceAllocationReversals.allocationId })
        .from(serviceAllocationReversals)
        .where(
          and(
            eq(serviceAllocationReversals.tenantId, principal.tenantId),
            eq(serviceAllocationReversals.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (keyUse) throw new BenefitAllocationConflictError();
      let reversal: typeof serviceAllocationReversals.$inferSelect | undefined;
      try {
        const inserted = await transaction
          .insert(serviceAllocationReversals)
          .values({
            id: uuidv7(),
            tenantId: principal.tenantId,
            clientId: allocation.clientId,
            allocationId,
            reason: input.reason.trim(),
            idempotencyKey: input.idempotencyKey,
            reversedBy: principal.userId,
            reversedAt: now,
          })
          .returning();
        reversal = inserted[0];
      } catch (error) {
        if (hasConstraint(error, 'service_allocation_reversals_idempotency_uq')) {
          throw new BenefitAllocationConflictError();
        }
        throw error;
      }
      if (!reversal) throw new Error('Allocation reversal insert returned no row');
      const ledger = await transaction
        .select()
        .from(benefitLedgerEntries)
        .where(
          and(
            eq(benefitLedgerEntries.tenantId, principal.tenantId),
            eq(benefitLedgerEntries.serviceAllocationId, allocationId),
            eq(benefitLedgerEntries.entryType, 'service_consumption_allocated'),
          ),
        );
      for (const [index, entry] of ledger.entries()) {
        await transaction.insert(benefitLedgerEntries).values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          clientId: allocation.clientId,
          fundingSourceId: allocation.fundingSourceId,
          allocationBucketId: entry.allocationBucketId,
          serviceAllocationId: allocationId,
          performedServiceId: allocation.performedServiceId,
          entryType: 'service_consumption_reversed',
          amountCents: Math.abs(entry.amountCents),
          effectiveDate: today(),
          sourceType: 'allocation_reversal',
          reference: input.reason.trim(),
          sourceReference: `service-reversal:${reversal.id}:${index}`,
          verificationStatus: entry.verificationStatus,
          recordedBy: principal.userId,
          recordedAt: now,
        });
      }
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action: 'benefit.allocation_reversed',
        resourceType: 'performed_service',
        resourceId: allocation.performedServiceId,
        metadata: { allocationId, reversalId: reversal.id, reason: input.reason.trim() },
        eventType: 'benefit.allocation_reversed',
        aggregateId: allocation.performedServiceId,
        payload: {
          allocationId,
          reversalId: reversal.id,
          performedServiceId: allocation.performedServiceId,
          clientId: allocation.clientId,
        },
      });
      return { allocationId, reversalId: reversal.id, reversedAt: reversal.reversedAt };
    });
  }

  async createRecognition(
    principal: AuthorizationPrincipal,
    input: {
      organizationId: string;
      recognizedOffering: string;
      jurisdiction: string;
      validFrom: string;
      validUntil?: string | null;
      reference?: string | null;
    },
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    if (
      !isDate(input.validFrom) ||
      (input.validUntil != null &&
        (!isDate(input.validUntil) || input.validUntil < input.validFrom)) ||
      !input.recognizedOffering.trim() ||
      input.recognizedOffering.trim().length > 160 ||
      !input.jurisdiction.trim() ||
      input.jurisdiction.length > 40 ||
      (input.reference != null && input.reference.length > 500)
    )
      throw new InvalidProviderRecognitionError();
    const now = new Date();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const [organization] = await transaction
        .select()
        .from(organizationsTable)
        .where(
          and(
            eq(organizationsTable.tenantId, principal.tenantId),
            eq(organizationsTable.id, input.organizationId),
          ),
        )
        .limit(1);
      if (
        !organization ||
        !can(principal, {
          action: 'benefits.manage',
          resource: { tenantId: principal.tenantId, organizationId: organization.id },
        })
      )
        throw new AuthorizationDeniedError('benefits.manage');
      const [recognition] = await transaction
        .insert(providerRecognitions)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          organizationId: input.organizationId,
          recognizedOffering: input.recognizedOffering.trim(),
          jurisdiction: input.jurisdiction.trim(),
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          reference: cleanOptional(input.reference),
          status: 'active',
          createdBy: principal.userId,
          createdAt: now,
        })
        .returning();
      if (!recognition) throw new Error('Provider recognition insert returned no row');
      await this.record({
        transaction,
        principal,
        context,
        auditContext,
        action: 'benefit.provider_recognition_created',
        resourceType: 'organization',
        resourceId: input.organizationId,
        metadata: {
          recognitionId: recognition.id,
          jurisdiction: recognition.jurisdiction,
          validFrom: recognition.validFrom,
          validUntil: recognition.validUntil,
        },
        eventType: 'benefit.provider_recognition_created',
        aggregateId: input.organizationId,
        payload: {
          recognitionId: recognition.id,
          organizationId: input.organizationId,
          jurisdiction: recognition.jurisdiction,
        },
      });
      return recognition;
    });
  }

  async listRecognitions(principal: AuthorizationPrincipal) {
    this.requireAnyGrant(principal, 'benefits.read');
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const rows = await transaction
        .select()
        .from(providerRecognitions)
        .where(eq(providerRecognitions.tenantId, principal.tenantId))
        .orderBy(asc(providerRecognitions.validFrom));
      return rows.filter((row) =>
        can(principal, {
          action: 'benefits.read',
          resource: { tenantId: principal.tenantId, organizationId: row.organizationId },
        }),
      );
    });
  }

  async estimate(
    principal: AuthorizationPrincipal,
    input: { clientId: string; serviceId: string; serviceDate: string; quantity: string },
  ) {
    if (!isDate(input.serviceDate) || !isQuantity(input.quantity))
      throw new InvalidBenefitAdjustmentError();
    return this.unitOfWork.transaction({ tenantId: principal.tenantId }, async (transaction) => {
      const client = await this.requireClient(
        transaction,
        principal,
        input.clientId,
        'benefits.read',
      );
      const [service] = await transaction
        .select()
        .from(serviceDefinitions)
        .where(
          and(
            eq(serviceDefinitions.tenantId, principal.tenantId),
            eq(serviceDefinitions.id, input.serviceId),
          ),
        )
        .limit(1);
      if (!service) throw new BenefitServiceNotEligibleError('SERVICE_NOT_FOUND');
      const price = client.organizationId
        ? await this.effectivePrice(
            transaction,
            principal.tenantId,
            service.id,
            client.organizationId,
            client.primaryFacilityId,
            input.serviceDate,
          )
        : null;
      let serviceAmountCents: number | null = null;
      if (price) {
        try {
          const calculated = calculateServicePriceCents(
            price.priceCents,
            price.pricingUnit,
            service.unit,
            input.quantity,
          );
          serviceAmountCents = calculated <= 2_000_000_000 ? calculated : null;
        } catch {
          serviceAmountCents = null;
        }
      }
      const grade = await this.careGradeAt(
        transaction,
        principal.tenantId,
        client.id,
        input.serviceDate,
      );
      const rules = await this.rules(transaction);
      const recognition = client.organizationId
        ? await this.isRecognized(
            transaction,
            principal.tenantId,
            client.organizationId,
            'DE-NW',
            input.serviceDate,
          )
        : false;
      const entitlements = await transaction
        .select()
        .from(clientBenefitEntitlements)
        .where(
          and(
            eq(clientBenefitEntitlements.tenantId, principal.tenantId),
            eq(clientBenefitEntitlements.clientId, client.id),
            inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional']),
            lte(clientBenefitEntitlements.validFrom, input.serviceDate),
            or(
              isNull(clientBenefitEntitlements.validUntil),
              gte(clientBenefitEntitlements.validUntil, input.serviceDate),
            ),
          ),
        );
      const bucketRows = await transaction
        .select()
        .from(benefitAllocationBuckets)
        .where(
          and(
            eq(benefitAllocationBuckets.tenantId, principal.tenantId),
            eq(benefitAllocationBuckets.clientId, client.id),
          ),
        );
      const projectedBuckets = this.projectedBuckets(
        bucketRows,
        entitlements,
        rules,
        input.serviceDate,
      );
      const benefitOptions = [];
      for (const entitlement of entitlements) {
        const buckets = projectedBuckets.filter(
          (bucket) =>
            bucket.fundingSourceId === entitlement.fundingSourceId &&
            bucket.benefitType === entitlement.benefitType &&
            bucket.entitlementId === entitlement.id,
        );
        const entries = await this.listLedger(transaction, principal.tenantId, client.id);
        const facts = entries.map(toLedgerFact);
        const rule =
          entitlement.benefitType === 'private' || entitlement.benefitType === 'other'
            ? null
            : applicableRule(rules, entitlement.benefitType, 'DE', input.serviceDate);
        const hasExternalInput =
          entitlement.benefitType !== 'umwandlungsanspruch_45a_4' ||
          buckets.some((bucket) => bucket.bucketType === 'external_input');
        const eligible =
          entitlement.benefitType === 'private' || entitlement.benefitType === 'other'
            ? { eligible: true }
            : serviceBenefitEligibility({
                benefitType: entitlement.benefitType,
                serviceCategory: service.benefitCategory,
                jurisdiction: 'DE-NW',
                serviceDate: input.serviceDate,
                careGrade: grade,
                rule,
                recognized: recognition,
                externalInputRecorded: hasExternalInput,
              });
        const hasLedgerBalance =
          entitlement.benefitType !== 'private' && entitlement.benefitType !== 'other';
        const estimatedAvailableCents = hasLedgerBalance
          ? buckets.reduce(
              (sum, bucket) =>
                addCents(
                  sum,
                  bucketRemainingCents(bucket, facts, input.serviceDate, 'provisional'),
                ),
              0,
            )
          : null;
        const confirmedAvailableCents = hasLedgerBalance
          ? buckets.reduce(
              (sum, bucket) =>
                addCents(sum, bucketRemainingCents(bucket, facts, input.serviceDate, 'confirmed')),
              0,
            )
          : null;
        benefitOptions.push({
          entitlementId: entitlement.id,
          fundingSourceId: entitlement.fundingSourceId,
          benefitType: entitlement.benefitType,
          eligible: eligible.eligible,
          reason: eligible.reason ?? null,
          estimatedAvailableCents,
          confirmedAvailableCents,
        });
      }
      const estimated45bAvailableCents = benefitOptions
        .filter((option) => option.eligible && option.benefitType === 'entlastungsbetrag_45b')
        .reduce((sum, option) => addCents(sum, option.estimatedAvailableCents ?? 0), 0);
      const confirmed45bAvailableCents = benefitOptions
        .filter((option) => option.eligible && option.benefitType === 'entlastungsbetrag_45b')
        .reduce((sum, option) => addCents(sum, option.confirmedAvailableCents ?? 0), 0);
      const plannedEligible45bCents = client.organizationId
        ? await this.plannedEligible45bConsumption(
            transaction,
            principal.tenantId,
            client.id,
            client.organizationId,
            monthStart(input.serviceDate),
            entitlements,
            rules,
          )
        : 0;
      const hasEligible45b = benefitOptions.some(
        (option) => option.eligible && option.benefitType === 'entlastungsbetrag_45b',
      );
      return {
        clientId: client.id,
        serviceId: service.id,
        serviceDate: input.serviceDate,
        quantity: input.quantity,
        serviceAmountCents,
        servicePriceId: price?.id ?? null,
        estimated45bAvailableCents,
        confirmed45bAvailableCents,
        estimated45bAfterCents:
          serviceAmountCents === null || !hasEligible45b
            ? null
            : Math.max(
                0,
                estimated45bAvailableCents - plannedEligible45bCents - serviceAmountCents,
              ),
        plannedEligible45bCents,
        careGrade: grade,
        providerRecognized: recognition,
        benefitOptions,
        isEstimate: true,
      };
    });
  }

  private requireAnyGrant(principal: AuthorizationPrincipal, action: BenefitPermission) {
    if (!principal.grants.some((grant) => grant.permission === action))
      throw new AuthorizationDeniedError(action);
  }

  private async requireClient(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    clientId: string,
    action: BenefitPermission,
  ) {
    const [client] = await transaction
      .select()
      .from(clientRecords)
      .where(and(eq(clientRecords.tenantId, principal.tenantId), eq(clientRecords.id, clientId)))
      .limit(1);
    if (!client) throw new BenefitClientNotFoundError();
    const resource = {
      tenantId: principal.tenantId,
      clientId,
      ...(client.organizationId ? { organizationId: client.organizationId } : {}),
      ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
    };
    if (!can(principal, { action, resource })) throw new AuthorizationDeniedError(action);
    return client;
  }

  private async requireFundingSource(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    id: string,
  ) {
    const [source] = await transaction
      .select()
      .from(benefitFundingSources)
      .where(
        and(
          eq(benefitFundingSources.tenantId, tenantId),
          eq(benefitFundingSources.clientId, clientId),
          eq(benefitFundingSources.id, id),
        ),
      )
      .limit(1);
    if (!source) throw new BenefitFundingSourceNotFoundError();
    return source;
  }

  private async requireEntitlement(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    id: string,
  ) {
    const [entitlement] = await transaction
      .select()
      .from(clientBenefitEntitlements)
      .where(
        and(
          eq(clientBenefitEntitlements.tenantId, tenantId),
          eq(clientBenefitEntitlements.clientId, clientId),
          eq(clientBenefitEntitlements.id, id),
        ),
      )
      .limit(1);
    if (!entitlement) throw new BenefitEntitlementNotFoundError();
    return entitlement;
  }

  private async lockEntitlement(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    id: string,
  ) {
    const [entitlement] = await transaction
      .select()
      .from(clientBenefitEntitlements)
      .where(
        and(
          eq(clientBenefitEntitlements.tenantId, tenantId),
          eq(clientBenefitEntitlements.clientId, clientId),
          eq(clientBenefitEntitlements.id, id),
        ),
      )
      .for('update')
      .limit(1);
    if (!entitlement) throw new BenefitEntitlementNotFoundError();
    return entitlement;
  }

  private async findActiveEntitlement(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    fundingSourceId: string,
    benefitType: BenefitType,
    date: string,
  ) {
    const [entitlement] = await transaction
      .select()
      .from(clientBenefitEntitlements)
      .where(
        and(
          eq(clientBenefitEntitlements.tenantId, tenantId),
          eq(clientBenefitEntitlements.clientId, clientId),
          eq(clientBenefitEntitlements.fundingSourceId, fundingSourceId),
          eq(clientBenefitEntitlements.benefitType, benefitType),
          inArray(clientBenefitEntitlements.status, ['confirmed', 'provisional']),
          lte(clientBenefitEntitlements.validFrom, date),
          or(
            isNull(clientBenefitEntitlements.validUntil),
            gte(clientBenefitEntitlements.validUntil, date),
          ),
        ),
      )
      .orderBy(desc(clientBenefitEntitlements.validFrom))
      .limit(1);
    return entitlement ?? null;
  }

  private async rules(transaction: DatabaseTransaction): Promise<BenefitRule[]> {
    const rows = await transaction.select().from(benefitRuleVersions);
    return rows.map((row) => ({ ...row, eligibleCareGrades: row.eligibleCareGrades }));
  }

  private projectedBuckets(
    rows: readonly (typeof benefitAllocationBuckets.$inferSelect)[],
    entitlements: readonly (typeof clientBenefitEntitlements.$inferSelect)[],
    rules: readonly BenefitRule[],
    through: string,
  ): BenefitBucket[] {
    const persistedReferences = new Set(rows.map((row) => row.sourceReference));
    const projected = entitlements.flatMap((entitlement) =>
      this.monthlyBucketsFor(entitlement, rules, through).filter(
        (bucket) =>
          !persistedReferences.has(`entitlement:${entitlement.id}:${bucket.originPeriod}`),
      ),
    );
    return [...rows.map(toBucket), ...projected];
  }

  private monthlyBucketsFor(
    entitlement: typeof clientBenefitEntitlements.$inferSelect,
    rules: readonly BenefitRule[],
    through: string,
  ): BenefitBucket[] {
    if (entitlement.status === 'ended' && !entitlement.validUntil) return [];
    const allowedThrough =
      entitlement.validUntil && entitlement.validUntil < through ? entitlement.validUntil : through;
    if (
      entitlement.status === 'suspended' ||
      entitlement.validFrom > allowedThrough ||
      (entitlement.benefitType !== 'entlastungsbetrag_45b' &&
        entitlement.benefitType !== 'umwandlungsanspruch_45a_4')
    )
      return [];
    const verification = entitlementVerificationStatus(entitlement);
    return monthlyEntitlementBuckets(
      toEntitlementResponse(entitlement),
      rules,
      allowedThrough,
      verification,
    );
  }

  private async ensureMonthlyAllocations(
    transaction: DatabaseTransaction,
    principal: AuthorizationPrincipal,
    entitlement: typeof clientBenefitEntitlements.$inferSelect,
    rules: readonly BenefitRule[],
    through: string,
    context: RequestContext,
    auditContext: AuditContext,
  ) {
    const virtual = this.monthlyBucketsFor(entitlement, rules, through);
    for (const bucket of virtual) {
      const sourceReference = `entitlement:${entitlement.id}:${bucket.originPeriod}`;
      const [created] = await transaction
        .insert(benefitAllocationBuckets)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          clientId: entitlement.clientId,
          fundingSourceId: entitlement.fundingSourceId,
          entitlementId: entitlement.id,
          ruleVersionId: bucket.ruleVersionId ?? null,
          benefitType: entitlement.benefitType,
          originPeriod: bucket.originPeriod,
          amountCents: bucket.amountCents,
          expiresAt: bucket.expiresAt,
          bucketType: 'monthly_entitlement',
          verificationStatus: bucket.verificationStatus,
          sourceReference,
          createdBy: principal.userId,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: benefitAllocationBuckets.id });
      const bucketId =
        created?.id ??
        (
          await transaction
            .select({ id: benefitAllocationBuckets.id })
            .from(benefitAllocationBuckets)
            .where(
              and(
                eq(benefitAllocationBuckets.tenantId, principal.tenantId),
                eq(benefitAllocationBuckets.sourceReference, sourceReference),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (!bucketId) continue;
      const [entry] = await transaction
        .insert(benefitLedgerEntries)
        .values({
          id: uuidv7(),
          tenantId: principal.tenantId,
          clientId: entitlement.clientId,
          fundingSourceId: entitlement.fundingSourceId,
          allocationBucketId: bucketId,
          serviceAllocationId: null,
          performedServiceId: null,
          entryType: 'entitlement_allocated',
          amountCents: bucket.amountCents,
          effectiveDate: bucket.originPeriod,
          sourceType: 'benefit_rule',
          reference: entitlement.id,
          sourceReference: `${sourceReference}:ledger`,
          verificationStatus: bucket.verificationStatus,
          recordedBy: principal.userId,
          recordedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: benefitLedgerEntries.id });
      const rule = rules.find((item) => item.id === bucket.ruleVersionId);
      if (entry && rule) {
        await this.record({
          transaction,
          principal,
          context,
          auditContext,
          action: 'benefit.entitlement_period_allocated',
          resourceType: 'client',
          resourceId: entitlement.clientId,
          metadata: {
            entitlementId: entitlement.id,
            ledgerEntryId: entry.id,
            bucketId,
            period: bucket.originPeriod,
            amountCents: bucket.amountCents,
            ruleVersion: rule.ruleVersion,
          },
          eventType: 'benefit.entitlement_period_allocated',
          aggregateId: entitlement.id,
          payload: {
            entitlementId: entitlement.id,
            clientId: entitlement.clientId,
            benefitType: entitlement.benefitType,
            period: bucket.originPeriod,
            amountCents: bucket.amountCents,
            ruleVersion: rule.ruleVersion,
          },
        });
      }
    }
  }

  private async listBuckets(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    fundingSourceId: string,
    benefitType: BenefitType,
    entitlementId: string,
  ) {
    return transaction
      .select()
      .from(benefitAllocationBuckets)
      .where(
        and(
          eq(benefitAllocationBuckets.tenantId, tenantId),
          eq(benefitAllocationBuckets.clientId, clientId),
          eq(benefitAllocationBuckets.fundingSourceId, fundingSourceId),
          eq(benefitAllocationBuckets.benefitType, benefitType),
          eq(benefitAllocationBuckets.entitlementId, entitlementId),
        ),
      )
      .orderBy(asc(benefitAllocationBuckets.expiresAt), asc(benefitAllocationBuckets.originPeriod));
  }

  private async listLedger(transaction: DatabaseTransaction, tenantId: string, clientId: string) {
    return transaction
      .select()
      .from(benefitLedgerEntries)
      .where(
        and(
          eq(benefitLedgerEntries.tenantId, tenantId),
          eq(benefitLedgerEntries.clientId, clientId),
        ),
      );
  }

  private async careGradeAt(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    date: string,
  ): Promise<number | null> {
    const [grade] = await transaction
      .select({ grade: pflegegradRecords.grade })
      .from(pflegegradRecords)
      .where(
        and(
          eq(pflegegradRecords.tenantId, tenantId),
          eq(pflegegradRecords.clientId, clientId),
          eq(pflegegradRecords.status, 'confirmed'),
          lte(pflegegradRecords.validFrom, date),
          or(isNull(pflegegradRecords.validUntil), gte(pflegegradRecords.validUntil, date)),
        ),
      )
      .orderBy(desc(pflegegradRecords.validFrom))
      .limit(1);
    return grade?.grade ?? null;
  }

  private async isRecognized(
    transaction: DatabaseTransaction,
    tenantId: string,
    organizationId: string,
    jurisdiction: string,
    date: string,
  ) {
    const [recognition] = await transaction
      .select({ id: providerRecognitions.id })
      .from(providerRecognitions)
      .where(
        and(
          eq(providerRecognitions.tenantId, tenantId),
          eq(providerRecognitions.organizationId, organizationId),
          eq(providerRecognitions.jurisdiction, jurisdiction),
          eq(providerRecognitions.status, 'active'),
          lte(providerRecognitions.validFrom, date),
          or(isNull(providerRecognitions.validUntil), gte(providerRecognitions.validUntil, date)),
        ),
      )
      .limit(1);
    return Boolean(recognition);
  }

  private async effectivePrice(
    transaction: DatabaseTransaction,
    tenantId: string,
    serviceId: string,
    organizationId: string,
    facilityId: string | null,
    date: string,
  ) {
    const rows = await transaction
      .select()
      .from(servicePrices)
      .where(
        and(
          eq(servicePrices.tenantId, tenantId),
          eq(servicePrices.serviceId, serviceId),
          eq(servicePrices.organizationId, organizationId),
          lte(servicePrices.validFrom, date),
          or(isNull(servicePrices.validUntil), gt(servicePrices.validUntil, date)),
          or(
            isNull(servicePrices.facilityId),
            facilityId
              ? eq(servicePrices.facilityId, facilityId)
              : isNull(servicePrices.facilityId),
          ),
        ),
      )
      .orderBy(asc(servicePrices.facilityId));
    return (
      (facilityId ? rows.find((row) => row.facilityId === facilityId) : undefined) ??
      rows.find((row) => row.facilityId === null) ??
      null
    );
  }

  private async plannedEligible45bConsumption(
    transaction: DatabaseTransaction,
    tenantId: string,
    clientId: string,
    organizationId: string,
    period: string,
    entitlements: readonly (typeof clientBenefitEntitlements.$inferSelect)[],
    rules: readonly BenefitRule[],
  ) {
    if (!entitlements.some((item) => item.benefitType === 'entlastungsbetrag_45b')) return 0;
    const from = new Date(`${period}T00:00:00.000Z`);
    const until = new Date(`${nextMonth(period)}T00:00:00.000Z`);
    const rows = await transaction
      .select({ visit: visits, service: visitServices, definition: serviceDefinitions })
      .from(visits)
      .innerJoin(
        visitServices,
        and(eq(visitServices.tenantId, visits.tenantId), eq(visitServices.visitId, visits.id)),
      )
      .innerJoin(
        serviceDefinitions,
        and(
          eq(serviceDefinitions.tenantId, visitServices.tenantId),
          eq(serviceDefinitions.id, visitServices.serviceDefinitionId),
        ),
      )
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.clientId, clientId),
          eq(visits.organizationId, organizationId),
          inArray(visits.status, ['planned', 'confirmed']),
          gte(visits.plannedStart, from),
          lte(visits.plannedStart, new Date(until.getTime() - 1)),
        ),
      );
    let total = 0;
    const gradeByDate = new Map<string, number | null>();
    const recognitionByContext = new Map<string, boolean>();
    for (const row of rows) {
      if (row.definition.benefitCategory !== 'recognized_support') continue;
      const date = serviceDate(row.visit.plannedStart, row.visit.timezone);
      const hasEntitlement = entitlements.some(
        (item) =>
          item.benefitType === 'entlastungsbetrag_45b' &&
          ['confirmed', 'provisional'].includes(item.status) &&
          entitlementCovers(item, date),
      );
      if (!hasEntitlement || !applicableRule(rules, 'entlastungsbetrag_45b', 'DE', date)) continue;
      if (!gradeByDate.has(date))
        gradeByDate.set(date, await this.careGradeAt(transaction, tenantId, clientId, date));
      const grade = gradeByDate.get(date) ?? null;
      const rule = applicableRule(rules, 'entlastungsbetrag_45b', 'DE', date);
      if (grade === null || !rule?.eligibleCareGrades.includes(grade)) continue;
      const contextKey = `${row.visit.organizationId}:${date}`;
      if (!recognitionByContext.has(contextKey)) {
        recognitionByContext.set(
          contextKey,
          await this.isRecognized(transaction, tenantId, row.visit.organizationId, 'DE-NW', date),
        );
      }
      if (!recognitionByContext.get(contextKey)) continue;
      const price = await this.effectivePrice(
        transaction,
        tenantId,
        row.service.serviceDefinitionId,
        row.visit.organizationId,
        row.visit.facilityId,
        date,
      );
      if (!price) continue;
      try {
        total = addCents(
          total,
          calculateServicePriceCents(
            price.priceCents,
            price.pricingUnit,
            row.service.unitSnapshot,
            row.service.plannedQuantity,
          ),
        );
      } catch {
        continue;
      }
    }
    return total;
  }

  private async record(input: {
    transaction: DatabaseTransaction;
    principal: AuthorizationPrincipal;
    context: RequestContext;
    auditContext: AuditContext;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }) {
    await this.audit.append(input.transaction, {
      id: uuidv7(),
      tenantId: input.principal.tenantId,
      actorId: input.principal.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      timestamp: new Date(),
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
      ...(input.auditContext.ip ? { ip: input.auditContext.ip } : {}),
      ...(input.auditContext.userAgent
        ? { userAgent: input.auditContext.userAgent.slice(0, 512) }
        : {}),
      metadata: input.metadata,
    });
    await this.outbox.enqueue(
      input.transaction,
      createDomainEvent({
        type: input.eventType as never,
        tenantId: input.principal.tenantId,
        aggregateType: 'benefit',
        aggregateId: input.aggregateId,
        actor: { type: 'user', id: input.principal.userId },
        correlationId: input.context.correlationId,
        payload: input.payload as never,
      }),
    );
  }
}
// oxlint-enable no-await-in-loop

export function createBenefitsApplicationService(
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  outbox: OutboxWriter,
) {
  return new BenefitsApplicationService(unitOfWork, audit, outbox);
}

function toBucket(row: typeof benefitAllocationBuckets.$inferSelect): BenefitBucket {
  return {
    id: row.id,
    fundingSourceId: row.fundingSourceId,
    entitlementId: row.entitlementId,
    ruleVersionId: row.ruleVersionId,
    benefitType: row.benefitType,
    originPeriod: row.originPeriod,
    amountCents: row.amountCents,
    expiresAt: row.expiresAt,
    verificationStatus: row.verificationStatus,
    bucketType: row.bucketType,
  };
}

function entitlementVerificationStatus(
  entitlement: typeof clientBenefitEntitlements.$inferSelect,
): VerificationStatus {
  if (entitlement.source === 'payer_confirmed') return 'payer_confirmed';
  return entitlement.source === 'client_reported' ? 'client_reported' : 'provider_reported';
}

function toLedgerFact(row: typeof benefitLedgerEntries.$inferSelect): BenefitLedgerFact {
  return {
    allocationBucketId: row.allocationBucketId,
    serviceAllocationId: row.serviceAllocationId,
    entryType: row.entryType,
    amountCents: row.amountCents,
    effectiveDate: row.effectiveDate,
    verificationStatus: row.verificationStatus,
  };
}

function toEntitlementResponse(row: typeof clientBenefitEntitlements.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    benefitType: row.benefitType,
    fundingSourceId: row.fundingSourceId,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    status: row.status,
    calculationMode: row.calculationMode,
    source: row.source,
    verifiedAt: row.verifiedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sourceMatchesBenefit(
  sourceType: FundingSourceInput['sourceType'],
  benefitType: BenefitType,
) {
  if (benefitType === 'entlastungsbetrag_45b' || benefitType === 'umwandlungsanspruch_45a_4')
    return sourceType === 'statutory_long_term_care_insurance';
  if (benefitType === 'private')
    return sourceType === 'self_pay' || sourceType === 'private_long_term_care_insurance';
  return true;
}

function isStatutoryBenefit(
  benefitType: BenefitType,
): benefitType is 'entlastungsbetrag_45b' | 'umwandlungsanspruch_45a_4' {
  return benefitType === 'entlastungsbetrag_45b' || benefitType === 'umwandlungsanspruch_45a_4';
}

function validSourceInput(input: FundingSourceInput) {
  return (
    [
      'statutory_long_term_care_insurance',
      'private_long_term_care_insurance',
      'self_pay',
      'other',
    ].includes(input.sourceType) &&
    (input.clientInsuranceId == null || isUuid(input.clientInsuranceId)) &&
    (input.label == null || (input.label.trim().length > 0 && input.label.trim().length <= 160))
  );
}

function assertEntitlementInput(input: EntitlementInput) {
  if (
    !['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'].includes(
      input.benefitType,
    ) ||
    !isUuid(input.fundingSourceId) ||
    !isDate(input.validFrom) ||
    (input.validUntil != null &&
      (!isDate(input.validUntil) || input.validUntil < input.validFrom)) ||
    !['confirmed', 'provisional'].includes(input.status) ||
    !['rule_based', 'manual', 'external_input'].includes(input.calculationMode) ||
    !['payer_confirmed', 'client_reported', 'provider_reported', 'contract'].includes(
      input.source,
    ) ||
    (input.status === 'confirmed' && !confirmedEntitlementAllowed(input.benefitType, input.source))
  )
    throw new InvalidBenefitEntitlementError();
  if (
    input.benefitType === 'umwandlungsanspruch_45a_4' &&
    input.calculationMode !== 'external_input'
  )
    throw new InvalidBenefitEntitlementError();
}

function confirmedEntitlementAllowed(benefitType: BenefitType, source: EntitlementInput['source']) {
  return (
    source === 'payer_confirmed' ||
    (source === 'contract' && (benefitType === 'private' || benefitType === 'other'))
  );
}

function assertAdjustmentInput(input: BenefitAdjustmentInput) {
  if (
    !isUuid(input.idempotencyKey) ||
    !isUuid(input.fundingSourceId) ||
    (input.entitlementId !== undefined && !isUuid(input.entitlementId)) ||
    !['entlastungsbetrag_45b', 'umwandlungsanspruch_45a_4', 'private', 'other'].includes(
      input.benefitType,
    ) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents === 0 ||
    Math.abs(input.amountCents) > 2_000_000_000 ||
    !isDate(input.effectiveDate) ||
    !['opening_balance', 'external_consumption', 'manual_adjustment', 'external_input'].includes(
      input.adjustmentType,
    ) ||
    !input.sourceType.trim() ||
    input.sourceType.length > 80 ||
    (input.reference != null && input.reference.length > 500) ||
    !['estimated', 'client_reported', 'provider_reported', 'payer_confirmed'].includes(
      input.verificationStatus,
    )
  )
    throw new InvalidBenefitAdjustmentError();
  if (input.benefitType === 'private') throw new InvalidBenefitAdjustmentError();
}

function validAllocationInput(input: ServiceAllocationInput) {
  return (
    isUuid(input.fundingSourceId) &&
    isUuid(input.entitlementId) &&
    Number.isSafeInteger(input.amountCents) &&
    input.amountCents > 0 &&
    input.amountCents <= 2_000_000_000 &&
    ['provisional', 'confirmed'].includes(input.status) &&
    isUuid(input.idempotencyKey) &&
    (input.manualServiceAmountCents === undefined ||
      (Number.isSafeInteger(input.manualServiceAmountCents) &&
        input.manualServiceAmountCents > 0 &&
        input.manualServiceAmountCents <= 2_000_000_000))
  );
}

function entitlementCovers(
  entitlement: typeof clientBenefitEntitlements.$inferSelect,
  date: string,
) {
  return (
    entitlement.validFrom <= date &&
    (entitlement.validUntil === null || entitlement.validUntil >= date)
  );
}

function bucketExpiry(benefitType: BenefitType, date: string) {
  if (benefitType !== 'entlastungsbetrag_45b') return null;
  return `${Number(date.slice(0, 4)) + 1}-06-30`;
}

function cleanOptional(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

function assertDate(value: string) {
  if (!isDate(value)) throw new InvalidBenefitAdjustmentError();
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, until: string): number {
  return (
    (new Date(`${until}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
    86_400_000
  );
}

function isQuantity(value: string) {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return false;
  return Number(value) > 0 && Number.isFinite(Number(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function serviceDate(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function hasConstraint(error: unknown, constraint: string): boolean {
  const candidate = error as { constraint?: unknown; cause?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') return false;
  return (
    candidate.constraint === constraint ||
    (candidate.cause !== undefined &&
      candidate.cause !== error &&
      hasConstraint(candidate.cause, constraint))
  );
}
