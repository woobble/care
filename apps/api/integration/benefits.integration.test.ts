import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '@app/api/app.module';
import { databaseSchema } from '@app/api/database/schema';
import { configureApiHttp, createApiFastifyAdapter } from '@app/api/http/fastify';
import { DrizzleAuditWriter } from '@care/audit';
import { createBenefitsApplicationService } from '@care/benefits';
import { asUUID } from '@care/contracts';
import { createDatabase, createUnitOfWork } from '@care/database';
import type { AuthorizationPrincipal } from '@care/permissions';
import { DrizzleOutboxRepository } from '@care/platform';
import { startCareTestDatabase } from '@care/testing';

describe('benefits PostgreSQL integration', () => {
  test('enforces eligibility and tenant scope while recording split allocations as immutable history', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const applicationDatabase = createDatabase(testDatabase.appUrl, databaseSchema);
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const userId = uuidv7();
    const organizationId = uuidv7();
    const otherOrganizationId = uuidv7();
    const facilityId = uuidv7();
    const otherFacilityId = uuidv7();
    const clientId = uuidv7();
    const otherClientId = uuidv7();
    const carryoverClientId = uuidv7();
    const employeeId = uuidv7();
    const insuranceId = uuidv7();
    const carryoverInsuranceId = uuidv7();
    const categoryId = uuidv7();
    const serviceId = uuidv7();
    const clinicalServiceId = uuidv7();
    const httpSubject = uuidv7();
    const serviceDate = new Date().toISOString().slice(0, 10);
    const previousServiceDate = addDays(serviceDate, -1);
    const now = new Date();
    const context = {
      requestId: asUUID(uuidv7()),
      correlationId: asUUID(uuidv7()),
      userId: asUUID(userId),
      tenantId: asUUID(tenantId),
      organizationId: asUUID(organizationId),
    };
    const principal: AuthorizationPrincipal = {
      userId,
      tenantId,
      grants: (
        [
          'benefits.read',
          'benefits.manage',
          'benefits.adjust',
          'benefits.allocate',
          'benefits.review',
        ] as const
      ).map((permission) => ({ permission, scopeType: 'tenant', scopeId: tenantId })),
    };
    const benefits = createBenefitsApplicationService(
      createUnitOfWork(applicationDatabase.db),
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(applicationDatabase.db),
    );
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const keyId = uuidv7();
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    const oidc = await startOidcServer(publicJwk);
    let api: NestFastifyApplication | undefined;

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Benefits tenant', $2), ($3, 'Other benefits tenant', $4)`,
        [tenantId, `benefits-${tenantId}`, otherTenantId, `benefits-${otherTenantId}`],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name)
         VALUES ($1, $2, 'Benefits provider'), ($3, $4, 'Other benefits provider')`,
        [organizationId, tenantId, otherOrganizationId, otherTenantId],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name)
         VALUES ($1, $2, $3, 'Benefits facility'), ($4, $5, $6, 'Other benefits facility')`,
        [facilityId, tenantId, organizationId, otherFacilityId, otherTenantId, otherOrganizationId],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, 'Ada', 'Example', 'active', $5, $5),
           ($6, $7, $8, $9, 'Other', 'Client', 'active', $5, $5),
           ($10, $2, $3, $4, 'Carryover', 'Example', 'active', $5, $5)`,
        [
          clientId,
          tenantId,
          organizationId,
          facilityId,
          now,
          otherClientId,
          otherTenantId,
          otherOrganizationId,
          otherFacilityId,
          carryoverClientId,
        ],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, first_name, last_name)
         VALUES ($1, $2, 'Integration', 'Caregiver')`,
        [employeeId, tenantId],
      );
      await owner.query(
        `INSERT INTO clients.client_insurances
           (id, tenant_id, client_id, insurance_type, insurer_name, insurance_number, member_number, valid_from, is_primary, created_at, updated_at)
         VALUES
           ($1, $2, $3, 'pflegeversicherung', 'Example Pflegekasse', 'INS-ADA-001', 'MEM-ADA-001', $4, true, $5, $5),
           ($6, $2, $7, 'pflegeversicherung', 'Example Pflegekasse', 'INS-CARRY-001', 'MEM-CARRY-001', '2025-01-01', true, $5, $5)`,
        [
          insuranceId,
          tenantId,
          clientId,
          previousServiceDate,
          now,
          carryoverInsuranceId,
          carryoverClientId,
        ],
      );
      await owner.query(
        `INSERT INTO clients.pflegegrad_records
           (id, tenant_id, client_id, grade, valid_from, status, created_at, updated_at)
         VALUES
           ($1, $2, $3, 3, $4, 'confirmed', $6, $6),
           ($5, $2, $7, 2, '2025-01-01', 'confirmed', $6, $6)`,
        [uuidv7(), tenantId, clientId, serviceDate, uuidv7(), now, carryoverClientId],
      );
      await owner.query(
        `INSERT INTO services.service_categories
           (id, tenant_id, name, status, created_at, updated_at)
         VALUES ($1, $2, 'Betreuung', 'active', $3, $3)`,
        [categoryId, tenantId, now],
      );
      await owner.query(
        `INSERT INTO services.service_definitions
           (id, tenant_id, code, name, category_id, unit, benefit_category, status, valid_from, created_at, updated_at)
         VALUES
           ($1, $2, 'BETREUUNG', 'Alltagsbegleitung', $3, 'hour', 'recognized_support', 'active', $4, $5, $5),
           ($6, $2, 'NURSING', 'Clinical nursing', $3, 'hour', 'clinical_nursing', 'active', $4, $5, $5)`,
        [serviceId, tenantId, categoryId, previousServiceDate, now, clinicalServiceId],
      );
      await owner.query(
        `INSERT INTO services.service_prices
           (id, tenant_id, service_id, organization_id, facility_id, price_cents, pricing_unit, valid_from, created_by, created_at)
         VALUES
           ($1, $2, $3, $4, $5, 4500, 'hour', $6, $7, $8),
           ($9, $2, $10, $4, $5, 4500, 'hour', $6, $7, $8)`,
        [
          uuidv7(),
          tenantId,
          serviceId,
          organizationId,
          facilityId,
          previousServiceDate,
          userId,
          now,
          uuidv7(),
          clinicalServiceId,
        ],
      );
      const priorServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate: previousServiceDate,
        now,
      });
      const performedServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate,
        now,
      });
      const clinicalPerformedServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId: clinicalServiceId,
        serviceDate,
        now,
      });
      const httpPerformedServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate,
        now,
      });
      const concurrentPerformedServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate,
        now,
      });

      const statutorySource = await benefits.createFundingSource(
        principal,
        clientId,
        { sourceType: 'statutory_long_term_care_insurance', clientInsuranceId: insuranceId },
        context,
        {},
      );
      const statutoryEntitlement = await benefits.createEntitlement(
        principal,
        clientId,
        {
          benefitType: 'entlastungsbetrag_45b',
          fundingSourceId: statutorySource.id,
          validFrom: previousServiceDate,
          status: 'confirmed',
          calculationMode: 'rule_based',
          source: 'payer_confirmed',
        },
        context,
        {},
      );
      const privateSource = await benefits.createFundingSource(
        principal,
        clientId,
        { sourceType: 'self_pay', label: 'Private payment' },
        context,
        {},
      );
      const privateEntitlement = await benefits.createEntitlement(
        principal,
        clientId,
        {
          benefitType: 'private',
          fundingSourceId: privateSource.id,
          validFrom: previousServiceDate,
          status: 'confirmed',
          calculationMode: 'manual',
          source: 'contract',
        },
        context,
        {},
      );

      const statutoryAllocation = {
        fundingSourceId: statutorySource.id,
        entitlementId: statutoryEntitlement.id,
        amountCents: 6000,
        status: 'confirmed' as const,
        idempotencyKey: uuidv7(),
      };
      await expect(
        benefits.allocateService(principal, performedServiceId, [statutoryAllocation], context, {}),
      ).rejects.toMatchObject({ code: 'BENEFIT_PROVIDER_RECOGNITION_REQUIRED' });

      await benefits.createRecognition(
        principal,
        {
          organizationId,
          recognizedOffering: 'Angebote zur Unterstützung im Alltag',
          jurisdiction: 'DE-NW',
          validFrom: '2025-01-01',
          reference: 'Integration recognition record',
        },
        context,
        {},
      );

      const carryoverSource = await benefits.createFundingSource(
        principal,
        carryoverClientId,
        {
          sourceType: 'statutory_long_term_care_insurance',
          clientInsuranceId: carryoverInsuranceId,
        },
        context,
        {},
      );
      const carryoverEntitlement = await benefits.createEntitlement(
        principal,
        carryoverClientId,
        {
          benefitType: 'entlastungsbetrag_45b',
          fundingSourceId: carryoverSource.id,
          validFrom: '2025-06-01',
          validUntil: '2025-06-30',
          status: 'confirmed',
          calculationMode: 'rule_based',
          source: 'payer_confirmed',
        },
        context,
        {},
      );
      const budgetOnCarryoverExpiry = await benefits.getBudget(
        principal,
        carryoverClientId,
        '2026-06-30',
      );
      expect(
        budgetOnCarryoverExpiry.entitlementBudgets.find(
          (line) => line.entitlementId === carryoverEntitlement.id,
        ),
      ).toMatchObject({
        carryoverCents: 13_100,
        estimatedRemainingCents: 13_100,
        confirmedRemainingCents: 13_100,
        nextExpiry: '2026-06-30',
      });
      const budgetAfterCarryoverExpiry = await benefits.getBudget(
        principal,
        carryoverClientId,
        '2026-07-01',
      );
      expect(
        budgetAfterCarryoverExpiry.entitlementBudgets.find(
          (line) => line.entitlementId === carryoverEntitlement.id,
        ),
      ).toMatchObject({
        carryoverCents: 0,
        estimatedRemainingCents: 0,
        confirmedRemainingCents: 0,
        nextExpiry: null,
      });
      const currentCarryoverEntitlement = await benefits.createEntitlement(
        principal,
        carryoverClientId,
        {
          benefitType: 'entlastungsbetrag_45b',
          fundingSourceId: carryoverSource.id,
          validFrom: serviceDate,
          status: 'provisional',
          calculationMode: 'rule_based',
          source: 'provider_reported',
        },
        context,
        {},
      );
      const currentCarryoverServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId: carryoverClientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate,
        now,
      });
      await expect(
        benefits.allocateService(
          principal,
          currentCarryoverServiceId,
          [
            {
              fundingSourceId: carryoverSource.id,
              entitlementId: carryoverEntitlement.id,
              amountCents: 9_000,
              status: 'confirmed',
              idempotencyKey: uuidv7(),
            },
          ],
          context,
          {},
        ),
      ).rejects.toMatchObject({ code: 'BENEFIT_ENTITLEMENT_NOT_FOUND' });
      const currentCarryoverAllocation = await benefits.allocateService(
        principal,
        currentCarryoverServiceId,
        [
          {
            fundingSourceId: carryoverSource.id,
            entitlementId: currentCarryoverEntitlement.id,
            amountCents: 9_000,
            status: 'provisional',
            idempotencyKey: uuidv7(),
          },
        ],
        context,
        {},
      );
      expect(currentCarryoverAllocation).toMatchObject({
        allocatedCents: 9_000,
        remainingCents: 0,
      });
      const expiredCarryoverConsumption = await owner.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM benefits.ledger_entries AS entry
         JOIN benefits.allocation_buckets AS bucket
           ON bucket.tenant_id = entry.tenant_id AND bucket.id = entry.allocation_bucket_id
         WHERE entry.tenant_id = $1 AND bucket.entitlement_id = $2
           AND entry.entry_type = 'service_consumption_allocated'`,
        [tenantId, carryoverEntitlement.id],
      );
      expect(expiredCarryoverConsumption.rows[0]?.count).toBe('0');
      await benefits.recordAdjustment(
        principal,
        carryoverClientId,
        {
          idempotencyKey: uuidv7(),
          fundingSourceId: carryoverSource.id,
          entitlementId: currentCarryoverEntitlement.id,
          benefitType: 'entlastungsbetrag_45b',
          amountCents: -4_100,
          effectiveDate: serviceDate,
          adjustmentType: 'external_consumption',
          sourceType: 'synthetic_external_statement',
          reference: 'Synthetic provider-reported external consumption for bucket exhaustion.',
          verificationStatus: 'provider_reported',
        },
        context,
        {},
      );
      const exhaustedBudget = await benefits.getBudget(principal, carryoverClientId, serviceDate);
      expect(
        exhaustedBudget.entitlementBudgets.find(
          (line) => line.entitlementId === currentCarryoverEntitlement.id,
        ),
      ).toMatchObject({ estimatedRemainingCents: 0, confirmedRemainingCents: 0 });
      const exhaustedBalanceServiceId = await insertCompletedService(owner, {
        tenantId,
        clientId: carryoverClientId,
        organizationId,
        facilityId,
        employeeId,
        serviceId,
        serviceDate,
        now,
      });
      await expect(
        benefits.allocateService(
          principal,
          exhaustedBalanceServiceId,
          [
            {
              fundingSourceId: carryoverSource.id,
              entitlementId: currentCarryoverEntitlement.id,
              amountCents: 9_000,
              status: 'provisional',
              idempotencyKey: uuidv7(),
            },
          ],
          context,
          {},
        ),
      ).rejects.toMatchObject({
        code: 'BENEFIT_BUDGET_INSUFFICIENT',
        missingAmountCents: 9_000,
      });
      await expect(
        benefits.allocateService(
          principal,
          priorServiceId,
          [{ ...statutoryAllocation, idempotencyKey: uuidv7() }],
          context,
          {},
        ),
      ).rejects.toMatchObject({
        code: 'BENEFIT_SERVICE_NOT_ELIGIBLE',
        reasonCode: 'PFLEGEGRAD_REQUIRED',
      });
      await expect(
        benefits.allocateService(
          principal,
          clinicalPerformedServiceId,
          [{ ...statutoryAllocation, idempotencyKey: uuidv7() }],
          context,
          {},
        ),
      ).rejects.toMatchObject({
        code: 'BENEFIT_SERVICE_NOT_ELIGIBLE',
        reasonCode: 'SERVICE_NOT_RECOGNIZED_SUPPORT',
      });

      const conversionEntitlement = await benefits.createEntitlement(
        principal,
        clientId,
        {
          benefitType: 'umwandlungsanspruch_45a_4',
          fundingSourceId: statutorySource.id,
          validFrom: serviceDate,
          status: 'provisional',
          calculationMode: 'external_input',
          source: 'provider_reported',
        },
        context,
        {},
      );
      const conversionAllocation = {
        fundingSourceId: statutorySource.id,
        entitlementId: conversionEntitlement.id,
        amountCents: 1_000,
        status: 'provisional' as const,
        idempotencyKey: uuidv7(),
      };
      await expect(
        benefits.allocateService(
          principal,
          performedServiceId,
          [conversionAllocation],
          context,
          {},
        ),
      ).rejects.toMatchObject({
        code: 'BENEFIT_SERVICE_NOT_ELIGIBLE',
        reasonCode: 'EXTERNAL_BENEFIT_INPUT_REQUIRED',
      });
      const estimateBeforeExternalInput = await benefits.estimate(principal, {
        clientId,
        serviceId,
        serviceDate,
        quantity: '2',
      });
      expect(
        estimateBeforeExternalInput.benefitOptions.find(
          (option) => option.entitlementId === conversionEntitlement.id,
        ),
      ).toMatchObject({ eligible: false, reason: 'EXTERNAL_BENEFIT_INPUT_REQUIRED' });

      const externalConversionInput = await benefits.recordAdjustment(
        principal,
        clientId,
        {
          idempotencyKey: uuidv7(),
          fundingSourceId: statutorySource.id,
          entitlementId: conversionEntitlement.id,
          benefitType: 'umwandlungsanspruch_45a_4',
          amountCents: 2_500,
          effectiveDate: serviceDate,
          adjustmentType: 'external_input',
          sourceType: 'synthetic_external_statement',
          reference: 'Synthetic provider-reported external-benefit input; not payer-confirmed.',
          verificationStatus: 'provider_reported',
        },
        context,
        {},
      );
      expect(externalConversionInput).toMatchObject({
        amountCents: 2_500,
        verificationStatus: 'provider_reported',
      });
      const estimateWithExternalInput = await benefits.estimate(principal, {
        clientId,
        serviceId,
        serviceDate,
        quantity: '2',
      });
      expect(
        estimateWithExternalInput.benefitOptions.find(
          (option) => option.entitlementId === conversionEntitlement.id,
        ),
      ).toMatchObject({
        eligible: true,
        estimatedAvailableCents: 2_500,
        confirmedAvailableCents: 0,
      });

      const privateAllocation = {
        fundingSourceId: privateSource.id,
        entitlementId: privateEntitlement.id,
        amountCents: 2_000,
        status: 'confirmed' as const,
        idempotencyKey: uuidv7(),
      };
      const allocations = [statutoryAllocation, conversionAllocation, privateAllocation];
      const allocationResult = await benefits.allocateService(
        principal,
        performedServiceId,
        allocations,
        context,
        {},
      );
      expect(allocationResult).toMatchObject({
        performedServiceId,
        serviceAmountCents: 9000,
        previouslyAllocatedCents: 0,
        allocatedCents: 9000,
        remainingCents: 0,
      });
      expect(allocationResult.allocations.map((allocation) => allocation.amountCents)).toEqual([
        6000, 1_000, 2_000,
      ]);

      const replay = await benefits.allocateService(
        principal,
        performedServiceId,
        allocations,
        context,
        {},
      );
      expect(replay.allocations.map((allocation) => allocation.id).sort()).toEqual(
        allocationResult.allocations.map((allocation) => allocation.id).sort(),
      );
      await expect(
        benefits.allocateService(
          principal,
          performedServiceId,
          [{ ...statutoryAllocation, amountCents: 6001 }],
          context,
          {},
        ),
      ).rejects.toMatchObject({ code: 'BENEFIT_ALLOCATION_CONFLICT' });
      await expect(
        benefits.allocateService(
          principal,
          performedServiceId,
          [{ ...statutoryAllocation, idempotencyKey: uuidv7(), amountCents: 1 }],
          context,
          {},
        ),
      ).rejects.toMatchObject({ code: 'BENEFIT_ALLOCATION_CONFLICT' });

      const competingAllocations = [
        { ...privateAllocation, amountCents: 6_000, idempotencyKey: uuidv7() },
        { ...privateAllocation, amountCents: 6_000, idempotencyKey: uuidv7() },
      ];
      const concurrentAllocationResults = await Promise.allSettled(
        competingAllocations.map((allocation) =>
          benefits.allocateService(
            principal,
            concurrentPerformedServiceId,
            [allocation],
            context,
            {},
          ),
        ),
      );
      const successfulConcurrentAllocations = concurrentAllocationResults.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejectedConcurrentAllocations = concurrentAllocationResults.filter(
        (result) => result.status === 'rejected',
      );
      expect(successfulConcurrentAllocations).toHaveLength(1);
      expect(rejectedConcurrentAllocations).toHaveLength(1);
      const winningAllocationResult = successfulConcurrentAllocations[0]!;
      if (winningAllocationResult.status !== 'fulfilled')
        throw new Error('Expected one concurrent funding allocation to succeed');
      expect(winningAllocationResult.value).toMatchObject({
        performedServiceId: concurrentPerformedServiceId,
        serviceAmountCents: 9_000,
        previouslyAllocatedCents: 0,
        allocatedCents: 6_000,
        remainingCents: 3_000,
      });
      expect(rejectedConcurrentAllocations[0]!.reason).toMatchObject({
        code: 'BENEFIT_ALLOCATION_CONFLICT',
      });

      const concurrentAllocationRows = await owner.query<{
        id: string;
        amount_cents: number;
        idempotency_key: string;
      }>(
        `SELECT id, amount_cents, idempotency_key FROM benefits.service_allocations
         WHERE tenant_id = $1 AND performed_service_id = $2`,
        [tenantId, concurrentPerformedServiceId],
      );
      expect(concurrentAllocationRows.rows).toHaveLength(1);
      const persistedConcurrentAllocation = concurrentAllocationRows.rows[0];
      if (!persistedConcurrentAllocation)
        throw new Error('Expected one concurrent funding allocation to persist');
      expect(persistedConcurrentAllocation.amount_cents).toBe(6_000);
      expect(competingAllocations.map((allocation) => allocation.idempotencyKey)).toContain(
        persistedConcurrentAllocation.idempotency_key,
      );
      const concurrentLedgerRows = await owner.query<{
        service_allocation_id: string;
        amount_cents: number;
      }>(
        `SELECT service_allocation_id, amount_cents FROM benefits.ledger_entries
         WHERE tenant_id = $1 AND performed_service_id = $2
           AND entry_type = 'service_consumption_allocated'`,
        [tenantId, concurrentPerformedServiceId],
      );
      expect(concurrentLedgerRows.rows).toHaveLength(1);
      expect(concurrentLedgerRows.rows[0]).toMatchObject({
        service_allocation_id: persistedConcurrentAllocation.id,
        amount_cents: -6_000,
      });
      const concurrentOutboxRows = await owner.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event_type = 'benefit.service_allocated'
           AND event->>'aggregateId' = $2`,
        [tenantId, concurrentPerformedServiceId],
      );
      expect(concurrentOutboxRows.rows[0]?.count).toBe('1');

      const budget = await benefits.getBudget(principal, clientId, serviceDate);
      expect(
        budget.entitlementBudgets.find((line) => line.entitlementId === statutoryEntitlement.id),
      ).toMatchObject({
        actualConsumptionCents: 6000,
        confirmedRemainingCents: expect.any(Number),
      });
      expect(
        budget.entitlementBudgets.find((line) => line.entitlementId === conversionEntitlement.id),
      ).toMatchObject({
        actualConsumptionCents: 1_000,
        estimatedRemainingCents: 1_500,
        confirmedRemainingCents: 0,
        verificationStatuses: ['provider_reported'],
      });
      const ruleBucket = await owner.query<{ rule_version_id: string; amount_cents: number }>(
        `SELECT rule_version_id, amount_cents FROM benefits.allocation_buckets
         WHERE tenant_id = $1 AND entitlement_id = $2 AND bucket_type = 'monthly_entitlement'
         ORDER BY origin_period LIMIT 1`,
        [tenantId, statutoryEntitlement.id],
      );
      expect(ruleBucket.rows[0]).toMatchObject({
        rule_version_id: expect.any(String),
        amount_cents: 13100,
      });
      const ledgerBeforeProjection = await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM benefits.ledger_entries WHERE tenant_id = $1',
        [tenantId],
      );
      const outboxBeforeProjection = await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      const futureBudget = await benefits.getBudget(principal, clientId, addDays(serviceDate, 40));
      expect(
        futureBudget.entitlementBudgets.find(
          (line) => line.entitlementId === statutoryEntitlement.id,
        )?.currentAllocationCents,
      ).toBe(13100);
      const ledgerAfterProjection = await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM benefits.ledger_entries WHERE tenant_id = $1',
        [tenantId],
      );
      const outboxAfterProjection = await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      expect(ledgerAfterProjection.rows[0]?.count).toBe(ledgerBeforeProjection.rows[0]?.count);
      expect(outboxAfterProjection.rows[0]?.count).toBe(outboxBeforeProjection.rows[0]?.count);
      const ledger = await owner.query<{ id: string; entry_type: string; amount_cents: number }>(
        `SELECT id, entry_type, amount_cents FROM benefits.ledger_entries
         WHERE tenant_id = $1 AND service_allocation_id = ANY($2::uuid[])
         ORDER BY amount_cents`,
        [tenantId, allocationResult.allocations.map((allocation) => allocation.id)],
      );
      expect(ledger.rows.map((entry) => entry.entry_type)).toEqual([
        'service_consumption_allocated',
        'service_consumption_allocated',
        'service_consumption_allocated',
      ]);
      await expect(
        owner.query('UPDATE benefits.ledger_entries SET amount_cents = 1 WHERE id = $1', [
          ledger.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ code: '55000', constraint: 'benefit_history_immutable' });
      await expect(
        owner.query('DELETE FROM benefits.ledger_entries WHERE id = $1', [ledger.rows[0]!.id]),
      ).rejects.toMatchObject({ code: '55000', constraint: 'benefit_history_immutable' });

      await owner.query(
        `INSERT INTO benefits.funding_sources
           (id, tenant_id, client_id, source_type, label, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'self_pay', 'Other tenant source', 'active', $4, $5, $5)`,
        [uuidv7(), otherTenantId, otherClientId, userId, now],
      );
      await expect(benefits.getBudget(principal, otherClientId, serviceDate)).rejects.toMatchObject(
        {
          code: 'BENEFIT_CLIENT_NOT_FOUND',
        },
      );
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const currentTenantSources = await appRole.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM benefits.funding_sources ORDER BY tenant_id',
      );
      expect(currentTenantSources.rows.map((row) => row.tenant_id)).toEqual([
        tenantId,
        tenantId,
        tenantId,
      ]);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      const otherTenantSources = await appRole.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM benefits.funding_sources ORDER BY tenant_id',
      );
      expect(otherTenantSources.rows.map((row) => row.tenant_id)).toEqual([otherTenantId]);
      await appRole.query('COMMIT');
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      await expect(
        appRole.query(
          `INSERT INTO benefits.funding_sources
             (id, tenant_id, client_id, source_type, status, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, 'self_pay', 'active', $4, $5, $5)`,
          [uuidv7(), tenantId, clientId, userId, now],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK');

      const auditActions = await owner.query<{ action: string }>(
        'SELECT action FROM audit.audit_entries WHERE tenant_id = $1',
        [tenantId],
      );
      expect(auditActions.rows.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'benefit.funding_source_created',
          'benefit.entitlement_created',
          'benefit.provider_recognition_created',
          'benefit.service_allocated',
        ]),
      );
      const outboxEvents = await owner.query<{ event_type: string }>(
        'SELECT event_type FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      expect(outboxEvents.rows.map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          'benefit.funding_source_created',
          'benefit.entitlement_created',
          'benefit.provider_recognition_created',
          'benefit.service_allocated',
        ]),
      );

      await owner.query(
        'INSERT INTO identity.users (id, email, display_name) VALUES ($1, $2, $3)',
        [userId, 'benefits-api@integration.test', 'Benefits API Integration'],
      );
      await owner.query(
        'INSERT INTO identity.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)',
        [uuidv7(), userId, oidc.issuer, httpSubject],
      );
      await owner.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [uuidv7(), userId, tenantId],
      );
      const roleId = uuidv7();
      const membershipId = await owner.query<{ id: string }>(
        'SELECT id FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantId],
      );
      await owner.query('INSERT INTO identity.roles (id, tenant_id, name) VALUES ($1, $2, $3)', [
        roleId,
        tenantId,
        'Benefits API Integration',
      ]);
      await owner.query(
        `INSERT INTO identity.role_permissions (role_id, permission)
         VALUES ($1, 'benefits.read'), ($1, 'benefits.allocate'),
                ($1, 'benefits.review'), ($1, 'client.read')`,
        [roleId],
      );
      await owner.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membershipId.rows[0]!.id, tenantId, roleId],
      );
      await owner.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membershipId.rows[0]!.id, tenantId],
      );

      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = testDatabase.appUrl;
      process.env.OIDC_ISSUER = oidc.issuer;
      process.env.OIDC_CLIENT_ID = 'care-benefits-integration-test';
      process.env.WEB_ORIGIN = 'http://localhost:3000';
      process.env.API_PUBLIC_ORIGIN = 'http://localhost:3001';
      process.env.S3_ENDPOINT = 'http://127.0.0.1:8333';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'care-test-private';
      process.env.S3_ACCESS_KEY = 'care-test-access';
      process.env.S3_SECRET_KEY = 'care-test-secret';
      process.env.S3_FORCE_PATH_STYLE = 'true';

      api = await NestFactory.create<NestFastifyApplication>(AppModule, createApiFastifyAdapter(), {
        logger: false,
      });
      await configureApiHttp(api, 'http://localhost:3000');
      await api.listen(0, '127.0.0.1');
      const address = api.getHttpServer().address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyId })
        .setIssuer(oidc.issuer)
        .setAudience('care-benefits-integration-test')
        .setSubject(httpSubject)
        .setIssuedAt()
        .setExpirationTime('2 minutes')
        .sign(privateKey);
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      };

      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/budgets?asOf=${serviceDate}`,
      );
      expect(unauthenticated.status).toBe(401);

      const apiBudget = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/budgets?asOf=${serviceDate}`,
        { headers },
      );
      expect(apiBudget.status).toBe(200);
      expect(await apiBudget.json()).toMatchObject({ clientId });

      const searchedWorklist = await fetch(
        `${baseUrl}/api/v1/benefits/worklist?clientPage=1&clientPageSize=10&servicePage=1&servicePageSize=10&search=INS-ADA-001&benefitType=entlastungsbetrag_45b&period=${serviceDate.slice(0, 7)}`,
        { headers },
      );
      expect(searchedWorklist.status).toBe(200);
      const searchedWorklistResult = (await searchedWorklist.json()) as {
        clients: {
          page: number;
          pageSize: number;
          total: number;
          items: Array<{ clientId: string; clientName: string }>;
        };
        unallocatedServices: { page: number; pageSize: number };
      };
      expect(searchedWorklistResult.clients).toMatchObject({
        page: 1,
        pageSize: 10,
        total: 1,
        items: [{ clientId, clientName: 'Ada Example' }],
      });
      expect(searchedWorklistResult.unallocatedServices).toMatchObject({ page: 1, pageSize: 10 });
      const invalidWorklistPeriod = await fetch(
        `${baseUrl}/api/v1/benefits/worklist?period=2026-13`,
        { headers },
      );
      expect(invalidWorklistPeriod.status).toBe(400);

      const apiAllocation = await fetch(
        `${baseUrl}/api/v1/performed-services/${httpPerformedServiceId}/funding-allocations`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            allocations: [
              {
                fundingSourceId: privateSource.id,
                entitlementId: privateEntitlement.id,
                amountCents: 4500,
                status: 'confirmed',
                idempotencyKey: uuidv7(),
              },
            ],
          }),
        },
      );
      expect(apiAllocation.status).toBe(201);
      const httpAllocationResult = (await apiAllocation.json()) as {
        allocations: Array<{ id: string }>;
      };
      expect(httpAllocationResult).toMatchObject({
        performedServiceId: httpPerformedServiceId,
        serviceAmountCents: 9000,
        allocatedCents: 4500,
        remainingCents: 4500,
      });
      const allocationId = httpAllocationResult.allocations[0]!.id;

      const overAllocation = await fetch(
        `${baseUrl}/api/v1/performed-services/${httpPerformedServiceId}/funding-allocations`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            allocations: [
              {
                fundingSourceId: privateSource.id,
                entitlementId: privateEntitlement.id,
                amountCents: 4501,
                status: 'confirmed',
                idempotencyKey: uuidv7(),
              },
            ],
          }),
        },
      );
      expect(overAllocation.status).toBe(409);
      expect(await overAllocation.json()).toMatchObject({ code: 'BENEFIT_ALLOCATION_CONFLICT' });

      const reverseAllocation = await fetch(
        `${baseUrl}/api/v1/funding-allocations/${allocationId}/reverse`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: 'Corrected split', idempotencyKey: uuidv7() }),
        },
      );
      const reverseAllocationBody = await reverseAllocation.text();
      if (reverseAllocation.status !== 200) {
        throw new Error(
          `Allocation reversal returned ${reverseAllocation.status}: ${reverseAllocationBody}`,
        );
      }

      const budgetHistory = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/budget-history?page=1&pageSize=100`,
        { headers },
      );
      expect(budgetHistory.status).toBe(200);
      const historyResult = (await budgetHistory.json()) as {
        items: Array<{
          serviceAllocationId: string | null;
          allocationReversed: boolean;
          entryType: string;
          reference: string | null;
        }>;
      };
      expect(historyResult.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serviceAllocationId: allocationId,
            allocationReversed: true,
            entryType: 'service_consumption_allocated',
          }),
          expect.objectContaining({
            serviceAllocationId: allocationId,
            allocationReversed: true,
            entryType: 'service_consumption_reversed',
            reference: 'Corrected split',
          }),
        ]),
      );

      const budgetAfterReversal = await fetch(
        `${baseUrl}/api/v1/clients/${clientId}/budgets?asOf=${serviceDate}`,
        { headers },
      );
      expect(budgetAfterReversal.status).toBe(200);
      const budgetAfterReversalResult = (await budgetAfterReversal.json()) as {
        history: Array<{
          serviceAllocationId: string | null;
          allocationReversed: boolean;
          entryType: string;
        }>;
      };
      expect(budgetAfterReversalResult.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serviceAllocationId: allocationId,
            allocationReversed: true,
            entryType: 'service_consumption_allocated',
          }),
          expect.objectContaining({
            serviceAllocationId: allocationId,
            allocationReversed: true,
            entryType: 'service_consumption_reversed',
          }),
        ]),
      );

      const repeatedReversal = await fetch(
        `${baseUrl}/api/v1/funding-allocations/${allocationId}/reverse`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: 'Second correction', idempotencyKey: uuidv7() }),
        },
      );
      expect(repeatedReversal.status).toBe(409);
      expect(await repeatedReversal.json()).toMatchObject({
        code: 'BENEFIT_ALLOCATION_ALREADY_REVERSED',
      });

      const crossTenantBudget = await fetch(
        `${baseUrl}/api/v1/clients/${otherClientId}/budgets?asOf=${serviceDate}`,
        { headers },
      );
      expect(crossTenantBudget.status).toBe(404);
    } finally {
      await api?.close().catch(() => undefined);
      await closeServer(oidc.server).catch(() => undefined);
      await appRole.end().catch(() => undefined);
      await applicationDatabase.close();
      await owner.end().catch(() => undefined);
      await testDatabase.container.stop();
    }
  }, 240_000);
});

async function insertCompletedService(
  owner: Client,
  input: {
    tenantId: string;
    clientId: string;
    organizationId: string;
    facilityId: string;
    employeeId: string;
    serviceId: string;
    serviceDate: string;
    now: Date;
  },
): Promise<string> {
  const visitId = uuidv7();
  const executionId = uuidv7();
  const performedServiceId = uuidv7();
  const actualStart = `${input.serviceDate}T11:00:00.000Z`;
  const actualEnd = `${input.serviceDate}T12:00:00.000Z`;
  await owner.query(
    `INSERT INTO scheduling.visits
       (id, tenant_id, client_id, organization_id, facility_id, origin, status,
        planned_start, planned_end, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'Europe/Berlin', $8, $8)`,
    [
      visitId,
      input.tenantId,
      input.clientId,
      input.organizationId,
      input.facilityId,
      actualStart,
      actualEnd,
      input.now,
    ],
  );
  await owner.query(
    `INSERT INTO visit_execution.executions
       (id, tenant_id, visit_id, status, actual_start, actual_end,
        started_by_employee_id, completed_by_employee_id, version, created_at, updated_at)
     VALUES ($1, $2, $3, 'in_progress', $4, NULL, $5, NULL, 1, $6, $6)`,
    [executionId, input.tenantId, visitId, actualStart, input.employeeId, input.now],
  );
  await owner.query(
    `INSERT INTO visit_execution.performed_services
       (id, tenant_id, execution_id, visit_id, service_definition_id,
        service_code_snapshot, service_name_snapshot, unit_snapshot,
        actual_quantity, status, performed_by_employee_id, created_at, updated_at)
     SELECT $1, $2, $3, $4, definition.id, definition.code, definition.name,
            definition.unit, '2.000', 'performed', $5, $6, $6
     FROM services.service_definitions AS definition
     WHERE definition.tenant_id = $2 AND definition.id = $7`,
    [
      performedServiceId,
      input.tenantId,
      executionId,
      visitId,
      input.employeeId,
      input.now,
      input.serviceId,
    ],
  );
  await owner.query(
    `UPDATE visit_execution.executions
     SET status = 'completed', actual_end = $3, completed_by_employee_id = $4,
         version = 2, updated_at = $5
     WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, executionId, actualEnd, input.employeeId, input.now],
  );
  return performedServiceId;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function startOidcServer(jwk: JsonWebKey): Promise<{ server: Server; issuer: string }> {
  let issuer: string;
  let origin: string;
  const server: Server = createServer((request, response) => {
    if (request.url === '/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${origin}/jwks`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
    } else if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  issuer = `${origin}/`;
  return { server, issuer };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
