import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, test } from 'bun:test';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import type {
  AuthorizationPrincipal,
  CompetencyPolicyEvaluator,
  PermissionGrant,
} from '@care/permissions';
import {
  MedicationApplicationService,
  MedicationReconciliationApplicationService,
} from '@care/medication';
import type { DatabaseTransaction } from '@care/database';
import { DrizzleOutboxRepository } from '@care/platform';
import { startCareTestDatabase } from '@care/testing';
import { databaseSchema } from '../src/database/schema';

describe('medication PostgreSQL integration', () => {
  test('records assigned-visit administrations with immutable revisions, corrections, RLS, audit, and outbox', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const database = createDatabase(testDatabase.appUrl, databaseSchema);
    const unitOfWork = createUnitOfWork(database.db);
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const userId = uuidv7();
    const otherUserId = uuidv7();
    const organizationId = uuidv7();
    const facilityId = uuidv7();
    const otherOrganizationId = uuidv7();
    const otherFacilityId = uuidv7();
    const clientId = uuidv7();
    const employeeId = uuidv7();
    const otherClientId = uuidv7();
    const otherEmployeeId = uuidv7();
    const otherReconciliationId = uuidv7();
    const visitId = uuidv7();
    const now = new Date();
    const visitStart = new Date(now.getTime() - 2 * 60 * 60_000);
    const visitEnd = new Date(now.getTime() - 60 * 60_000);
    const validFrom = visitStart.toISOString().slice(0, 10);
    const anchorAt = new Date(visitStart.getTime() - 3 * 60 * 60_000).toISOString();
    const request = { requestId: uuidv7(), correlationId: uuidv7() };
    const auditContext = { ip: '127.0.0.1', userAgent: 'medication-integration-test' };
    const management = principal(tenantId, userId, [
      tenantGrant('medication.order.manage', tenantId),
    ]);
    const caregiver = principal(tenantId, userId, [
      assignedGrant('medication.read', userId),
      assignedGrant('medication.administer', userId),
      assignedGrant('medication_reconciliation.read', userId),
    ]);
    const unauthorizedCaregiver = principal(tenantId, otherUserId, [
      assignedGrant('medication.read', otherUserId),
      assignedGrant('medication.administer', otherUserId),
    ]);
    const correctionPrincipal = principal(tenantId, userId, [
      tenantGrant('medication.read', tenantId),
      tenantGrant('medication.administration.correct', tenantId),
    ]);
    const allowedCompetency = competencyEvaluator(employeeId, true);
    const medication = new MedicationApplicationService(
      unitOfWork,
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(database.db),
      allowedCompetency,
    );
    const reconciliationService = new MedicationReconciliationApplicationService(
      unitOfWork,
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(database.db),
      allowedCompetency,
      medication,
    );
    const reconciliationPrincipal = principal(tenantId, userId, [
      tenantGrant('medication.order.manage', tenantId),
      tenantGrant('medication_reconciliation.read', tenantId),
      tenantGrant('medication_reconciliation.create', tenantId),
      tenantGrant('medication_reconciliation.update', tenantId),
      tenantGrant('medication_reconciliation.complete', tenantId),
    ]);

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Medication tenant', $2), ($3, 'Other medication tenant', $4)`,
        [tenantId, `medication-${tenantId}`, otherTenantId, `medication-other-${otherTenantId}`],
      );
      await owner.query('INSERT INTO identity.users (id) VALUES ($1), ($2)', [userId, otherUserId]);
      await owner.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [uuidv7(), userId, tenantId],
      );
      await owner.query(
        'INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, $4)',
        [uuidv7(), otherUserId, otherTenantId, 'active'],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name, timezone)
         VALUES ($1, $2, 'Medication organization', 'UTC')`,
        [organizationId, tenantId],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name, timezone)
         VALUES ($1, $2, $3, 'Medication facility', 'UTC')`,
        [facilityId, tenantId, organizationId],
      );
      await owner.query(
        `INSERT INTO organizations.organizations (id, tenant_id, name, timezone)
         VALUES ($1, $2, 'Other medication organization', 'UTC')`,
        [otherOrganizationId, otherTenantId],
      );
      await owner.query(
        `INSERT INTO organizations.facilities (id, tenant_id, organization_id, name, timezone)
         VALUES ($1, $2, $3, 'Other medication facility', 'UTC')`,
        [otherFacilityId, otherTenantId, otherOrganizationId],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, first_name, last_name, status, created_at, updated_at, organization_id, primary_facility_id)
         VALUES ($1, $2, 'Alex', 'Example', 'active', $3, $3, $4, $5)`,
        [clientId, tenantId, now, organizationId, facilityId],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, user_id, first_name, last_name, status)
         VALUES ($1, $2, $3, 'Care', 'Worker', 'active')`,
        [employeeId, tenantId, userId],
      );
      await owner.query(
        `INSERT INTO clients.clients
           (id, tenant_id, organization_id, primary_facility_id, first_name, last_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Other', 'Client', 'active', $5, $5)`,
        [otherClientId, otherTenantId, otherOrganizationId, otherFacilityId, now],
      );
      await owner.query(
        'INSERT INTO employees.employees (id, tenant_id, user_id, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [otherEmployeeId, otherTenantId, otherUserId, 'Other', 'Worker', 'active'],
      );
      await owner.query(
        'INSERT INTO medication.reconciliations (id, tenant_id, client_id, status, reason, version, input_version, compared_input_version, comparison_version, started_by_employee_id, started_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11)',
        [
          otherReconciliationId,
          otherTenantId,
          otherClientId,
          'draft',
          'other',
          1,
          0,
          null,
          0,
          otherEmployeeId,
          now,
        ],
      );
      await owner.query(
        `INSERT INTO scheduling.visits
           (id, tenant_id, client_id, organization_id, facility_id, origin, status,
            planned_start, planned_end, timezone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed', $6, $7, 'UTC', $8, $8)`,
        [visitId, tenantId, clientId, organizationId, facilityId, visitStart, visitEnd, now],
      );
      await owner.query(
        `INSERT INTO scheduling.visit_assignments
           (id, tenant_id, visit_id, employee_id, status, assigned_at, assigned_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [uuidv7(), tenantId, visitId, employeeId, now, userId],
      );

      const definition = await medication.createDefinition(management, {
        name: 'Example medication',
        activeIngredient: 'Example ingredient',
        strength: '10 mg',
        dosageForm: 'tablet',
        route: 'oral',
        manufacturer: null,
        externalCode: null,
      });
      const definitionId = definition.id;
      const scheduledOrder = await medication.createOrder(
        management,
        clientId,
        {
          medicationDefinitionId: definitionId,
          doseAmount: '1',
          doseUnit: 'tablet',
          route: 'oral',
          instructions: null,
          indication: null,
          prescriberName: 'Dr Example',
          sourceType: 'prescriber',
          sourceReference: 'prescription-record-42',
          prescribedAt: null,
          validFrom,
          validUntil: null,
          schedule: { type: 'interval', anchorAt, intervalMinutes: 30 },
        },
        request,
        auditContext,
      );
      expect(scheduledOrder.order).toMatchObject({ status: 'draft', version: 1 });
      const activatedOrder = await medication.transitionOrder(
        management,
        scheduledOrder.order.id,
        1,
        'active',
        request,
        auditContext,
      );
      expect(activatedOrder.order).toMatchObject({ status: 'active', version: 2 });

      await expect(
        medication.administrationsForVisit(unauthorizedCaregiver, visitId),
      ).rejects.toMatchObject({ code: 'MEDICATION_ADMINISTRATION_NOT_AUTHORIZED' });
      const view = await medication.administrationsForVisit(caregiver, visitId);
      const due = view.due.filter((item) => item.scheduledAt.getTime() <= now.getTime());
      expect(due.length).toBeGreaterThanOrEqual(2);

      const pendingReview = await reconciliationService.start(
        reconciliationPrincipal,
        clientId,
        'periodic_review',
        request,
        auditContext,
      );
      await expect(
        reconciliationService.addSource(
          reconciliationPrincipal,
          pendingReview.reconciliation.id,
          pendingReview.reconciliation.version,
          {
            sourceType: 'physician',
            sourceName: null,
            sourceDate: '2026-99-99',
            reference: null,
          },
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_RECONCILIATION_INVALID', status: 400 });
      const visitViewDuringReview = await medication.administrationsForVisit(caregiver, visitId);
      expect(visitViewDuringReview.reconciliationReviewPending).toBe(true);
      expect(visitViewDuringReview.due.map((item) => item.occurrenceId)).toContain(
        due[0]!.occurrenceId,
      );
      await expect(
        reconciliationService.get(caregiver, pendingReview.reconciliation.id),
      ).rejects.toMatchObject({ code: 'MEDICATION_RECONCILIATION_NOT_AUTHORIZED', status: 403 });

      const deniedMedication = new MedicationApplicationService(
        unitOfWork,
        new DrizzleAuditWriter(),
        new DrizzleOutboxRepository(database.db),
        competencyEvaluator(employeeId, false),
      );
      await expect(
        deniedMedication.recordOccurrence(
          caregiver,
          due[0]!.occurrenceId,
          administration(visitId),
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_COMPETENCY_REQUIRED', status: 403 });

      const firstRecord = await medication.recordOccurrence(
        caregiver,
        due[0]!.occurrenceId,
        { ...administration(visitId), note: 'Sensitive care note stays out of events' },
        request,
        auditContext,
      );
      expect(firstRecord).toMatchObject({
        outcome: 'administered',
        orderVersion: 2,
        administeredByEmployeeId: employeeId,
      });

      const concurrentAttempts = await Promise.allSettled([
        medication.recordOccurrence(
          caregiver,
          due[1]!.occurrenceId,
          administration(visitId),
          request,
          auditContext,
        ),
        medication.recordOccurrence(
          caregiver,
          due[1]!.occurrenceId,
          administration(visitId),
          request,
          auditContext,
        ),
      ]);
      expect(concurrentAttempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(concurrentAttempts.filter((item) => item.status === 'rejected')).toHaveLength(1);
      const duplicateError = concurrentAttempts.find((item) => item.status === 'rejected');
      expect(duplicateError).toMatchObject({
        reason: { code: 'MEDICATION_ADMINISTRATION_ALREADY_RECORDED' },
      });

      const revisedOrder = await medication.reviseOrder(
        management,
        scheduledOrder.order.id,
        2,
        {
          medicationDefinitionId: definitionId,
          doseAmount: '2',
          doseUnit: 'tablet',
          route: 'oral',
          instructions: 'Updated order',
          indication: null,
          prescriberName: 'Dr Example',
          sourceType: 'prescriber',
          sourceReference: 'prescription-record-43',
          prescribedAt: null,
          validFrom,
          validUntil: null,
          schedule: { type: 'interval', anchorAt, intervalMinutes: 30 },
        },
        request,
        auditContext,
      );
      expect(revisedOrder.order).toMatchObject({ status: 'active', version: 3 });

      const prnOrder = await medication.createOrder(
        management,
        clientId,
        {
          medicationDefinitionId: definitionId,
          doseAmount: '1',
          doseUnit: 'tablet',
          route: 'oral',
          instructions: null,
          indication: 'Pain',
          prescriberName: 'Dr Example',
          sourceType: 'prescriber',
          sourceReference: 'prn-record-1',
          prescribedAt: null,
          validFrom,
          validUntil: null,
          schedule: {
            type: 'as_needed',
            indication: 'Pain',
            maximumDoseAmount: '1',
            maximumAdministrations: 1,
            frequencyWindowMinutes: 1440,
          },
        },
        request,
        auditContext,
      );
      await medication.transitionOrder(
        management,
        prnOrder.order.id,
        1,
        'active',
        request,
        auditContext,
      );
      const prnInput = { ...administration(visitId), administrationReason: 'Client reports pain' };
      const prnRecord = await medication.recordPrn(
        caregiver,
        prnOrder.order.id,
        prnInput,
        request,
        auditContext,
      );
      expect(prnRecord.outcome).toBe('administered');
      await expect(
        medication.recordPrn(caregiver, prnOrder.order.id, prnInput, request, auditContext),
      ).rejects.toMatchObject({ code: 'MEDICATION_PRN_LIMIT_EXCEEDED', status: 409 });

      const correction = await medication.correctAdministration(
        correctionPrincipal,
        firstRecord.id,
        {
          outcome: 'not_administered',
          actualDoseAmount: null,
          actualDoseUnit: null,
          reasonCode: 'client_unavailable',
          administrationReason: null,
          note: null,
          correctionReason: 'Outcome was entered in error',
        },
        request,
        auditContext,
      );
      expect(correction).toMatchObject({
        recordId: firstRecord.id,
        version: 1,
        correctedByEmployeeId: employeeId,
      });

      const currentDate = now.toISOString().slice(0, 10);
      const clientHistory = await medication.administrationsForClient(
        correctionPrincipal,
        clientId,
        {
          from: validFrom,
          until: currentDate,
        },
      );
      const correctedRecord = clientHistory.history.find((item) => item.id === firstRecord.id);
      expect(correctedRecord).toMatchObject({
        outcome: 'administered',
        orderVersion: 2,
        currentCorrection: {
          outcome: 'not_administered',
          correctionReason: 'Outcome was entered in error',
        },
      });
      expect(correctedRecord?.medication.name).toBe('Example medication');

      await reconciliationService.cancel(
        reconciliationPrincipal,
        pendingReview.reconciliation.id,
        pendingReview.reconciliation.version,
        'The medication plan changed during the fixture.',
        request,
        auditContext,
      );

      const startedReconciliation = await reconciliationService.start(
        reconciliationPrincipal,
        clientId,
        'hospital_discharge',
        request,
        auditContext,
      );
      const startedDetail = await reconciliationService.get(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
      );
      const scheduledBaseline = startedDetail.baselines.find(
        (item) => item.orderId === scheduledOrder.order.id,
      );
      const prnBaseline = startedDetail.baselines.find(
        (item) => item.orderId === prnOrder.order.id,
      );
      if (!scheduledBaseline || !prnBaseline) {
        throw new Error(
          'Both active medication orders must be included in the reconciliation snapshot',
        );
      }
      const baselineId = scheduledBaseline.id;
      let reconciliationVersion = startedReconciliation.reconciliation.version;
      const reconciliationSource = await reconciliationService.addSource(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        reconciliationVersion++,
        {
          sourceType: 'hospital_discharge',
          sourceName: 'Discharge medication list',
          sourceDate: now.toISOString().slice(0, 10),
          reference: 'discharge-reference-42',
        },
        request,
        auditContext,
      );
      const addReconciliationEntry = (baseline: typeof scheduledBaseline, doseAmount: string) =>
        reconciliationService.addEntry(
          reconciliationPrincipal,
          startedReconciliation.reconciliation.id,
          reconciliationVersion++,
          {
            sourceId: reconciliationSource.id,
            supersedesEntryId: null,
            correctionReason: null,
            medicationName: baseline.snapshot.medicationSnapshot.name,
            activeIngredient: baseline.snapshot.medicationSnapshot.activeIngredient,
            strength: baseline.snapshot.medicationSnapshot.strength,
            dosageForm: baseline.snapshot.medicationSnapshot.dosageForm,
            doseAmount,
            doseUnit: baseline.snapshot.doseUnit,
            route: baseline.snapshot.route,
            scheduleDescription: null,
            structuredSchedule: baseline.snapshot.schedule,
            reportedStatus:
              baseline.snapshot.status === 'active' ||
              baseline.snapshot.status === 'paused' ||
              baseline.snapshot.status === 'discontinued'
                ? baseline.snapshot.status
                : 'unknown',
            note: 'Sensitive external source note',
          },
          request,
          auditContext,
        );
      const reconciliationEntry = await addReconciliationEntry(scheduledBaseline, '1');
      const prnReconciliationEntry = await addReconciliationEntry(
        prnBaseline,
        prnBaseline.snapshot.doseAmount,
      );
      await reconciliationService.matchEntry(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        reconciliationVersion++,
        reconciliationEntry.id,
        baselineId,
        request,
        auditContext,
      );
      await reconciliationService.matchEntry(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        reconciliationVersion++,
        prnReconciliationEntry.id,
        prnBaseline.id,
        request,
        auditContext,
      );
      const comparison = await reconciliationService.compare(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        reconciliationVersion++,
        request,
        auditContext,
      );
      expect(comparison.discrepancies).toHaveLength(1);
      expect(comparison.discrepancies[0]).toMatchObject({ type: 'dose_mismatch', baselineId });
      const doseDiscrepancyId = comparison.discrepancies[0]!.id;
      await reconciliationService.decide(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        {
          expectedVersion: reconciliationVersion++,
          discrepancyId: doseDiscrepancyId,
          decision: 'accept_external',
          reason: 'Discharge plan reviewed',
          clarificationOutcome: null,
        },
        request,
        auditContext,
      );
      const actionId = uuidv7();
      const applicationRequest = {
        expectedVersion: reconciliationVersion++,
        actionId,
        items: [
          {
            discrepancyId: doseDiscrepancyId,
            disposition: 'apply_external' as const,
            reason: null,
          },
        ],
      };
      const applied = await reconciliationService.apply(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        applicationRequest,
        request,
        auditContext,
      );
      expect(applied.applications).toMatchObject([
        {
          discrepancyId: doseDiscrepancyId,
          disposition: 'applied',
          orderId: scheduledOrder.order.id,
          orderVersion: 4,
        },
      ]);
      expect(
        await reconciliationService.apply(
          reconciliationPrincipal,
          startedReconciliation.reconciliation.id,
          applicationRequest,
          request,
          auditContext,
        ),
      ).toMatchObject({ idempotent: true });
      await expect(
        reconciliationService.apply(
          reconciliationPrincipal,
          startedReconciliation.reconciliation.id,
          { ...applicationRequest, expectedVersion: reconciliationVersion, actionId: uuidv7() },
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_RECONCILIATION_APPLICATION_ALREADY_RECORDED' });
      const deniedReconciliationService = new MedicationReconciliationApplicationService(
        unitOfWork,
        new DrizzleAuditWriter(),
        new DrizzleOutboxRepository(database.db),
        competencyEvaluator(employeeId, false),
        medication,
      );
      await expect(
        deniedReconciliationService.complete(
          reconciliationPrincipal,
          startedReconciliation.reconciliation.id,
          reconciliationVersion,
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_COMPETENCY_REQUIRED', status: 403 });
      const completedReconciliation = await reconciliationService.complete(
        reconciliationPrincipal,
        startedReconciliation.reconciliation.id,
        reconciliationVersion++,
        request,
        auditContext,
      );
      expect(completedReconciliation).toMatchObject({
        status: 'completed',
        reviewedByEmployeeId: employeeId,
        version: reconciliationVersion,
      });
      await expect(
        reconciliationService.complete(
          reconciliationPrincipal,
          startedReconciliation.reconciliation.id,
          reconciliationVersion,
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_RECONCILIATION_INVALID_STATE' });
      await expect(
        owner.query('UPDATE medication.reconciliation_entries SET note = NULL WHERE id = $1', [
          reconciliationEntry.id,
        ]),
      ).rejects.toMatchObject({ constraint: 'medication_reconciliation_history_immutable_ck' });

      const staleReconciliation = await reconciliationService.start(
        reconciliationPrincipal,
        clientId,
        'physician_update',
        request,
        auditContext,
      );
      const staleId = staleReconciliation.reconciliation.id;
      const staleDetail = await reconciliationService.get(reconciliationPrincipal, staleId);
      const staleBaseline = staleDetail.baselines.find(
        (item) => item.orderId === scheduledOrder.order.id,
      );
      if (!staleBaseline) throw new Error('The order baseline for stale-order coverage is missing');
      let staleVersion = staleReconciliation.reconciliation.version;
      const staleSource = await reconciliationService.addSource(
        reconciliationPrincipal,
        staleId,
        staleVersion++,
        {
          sourceType: 'physician',
          sourceName: 'Physician medication list',
          sourceDate: now.toISOString().slice(0, 10),
          reference: 'physician-reference-43',
        },
        request,
        auditContext,
      );
      const staleEntry = await reconciliationService.addEntry(
        reconciliationPrincipal,
        staleId,
        staleVersion++,
        {
          sourceId: staleSource.id,
          supersedesEntryId: null,
          correctionReason: null,
          medicationName: staleBaseline.snapshot.medicationSnapshot.name,
          activeIngredient: staleBaseline.snapshot.medicationSnapshot.activeIngredient,
          strength: staleBaseline.snapshot.medicationSnapshot.strength,
          dosageForm: staleBaseline.snapshot.medicationSnapshot.dosageForm,
          doseAmount: '2',
          doseUnit: staleBaseline.snapshot.doseUnit,
          route: staleBaseline.snapshot.route,
          scheduleDescription: null,
          structuredSchedule: staleBaseline.snapshot.schedule,
          reportedStatus:
            staleBaseline.snapshot.status === 'active' ||
            staleBaseline.snapshot.status === 'paused' ||
            staleBaseline.snapshot.status === 'discontinued'
              ? staleBaseline.snapshot.status
              : 'unknown',
          note: null,
        },
        request,
        auditContext,
      );
      await reconciliationService.matchEntry(
        reconciliationPrincipal,
        staleId,
        staleVersion++,
        staleEntry.id,
        staleBaseline.id,
        request,
        auditContext,
      );
      const staleComparison = await reconciliationService.compare(
        reconciliationPrincipal,
        staleId,
        staleVersion++,
        request,
        auditContext,
      );
      const staleDoseFinding = staleComparison.discrepancies.find(
        (item) => item.type === 'dose_mismatch',
      );
      if (!staleDoseFinding)
        throw new Error('The stale order comparison did not find the changed dose');
      await reconciliationService.decide(
        reconciliationPrincipal,
        staleId,
        {
          expectedVersion: staleVersion++,
          discrepancyId: staleDoseFinding.id,
          decision: 'accept_external',
          reason: null,
          clarificationOutcome: null,
        },
        request,
        auditContext,
      );
      await medication.reviseOrder(
        management,
        scheduledOrder.order.id,
        4,
        {
          medicationDefinitionId: definitionId,
          doseAmount: '3',
          doseUnit: 'tablet',
          route: 'oral',
          instructions: 'Updated after the reconciliation snapshot',
          indication: null,
          prescriberName: 'Dr Example',
          sourceType: 'prescriber',
          sourceReference: 'prescription-record-44',
          prescribedAt: null,
          validFrom,
          validUntil: null,
          schedule: { type: 'interval', anchorAt, intervalMinutes: 30 },
        },
        request,
        auditContext,
      );
      await expect(
        reconciliationService.apply(
          reconciliationPrincipal,
          staleId,
          {
            expectedVersion: staleVersion,
            actionId: uuidv7(),
            items: [
              { discrepancyId: staleDoseFinding.id, disposition: 'apply_external', reason: null },
            ],
          },
          request,
          auditContext,
        ),
      ).rejects.toMatchObject({ code: 'MEDICATION_RECONCILIATION_STALE_ORDER', status: 409 });
      await reconciliationService.cancel(
        reconciliationPrincipal,
        staleId,
        staleVersion,
        'The medication order changed after the snapshot.',
        request,
        auditContext,
      );

      await expect(
        owner.query('UPDATE medication.administration_records SET note = NULL WHERE id = $1', [
          firstRecord.id,
        ]),
      ).rejects.toMatchObject({ constraint: 'medication_history_immutable_ck' });
      await expect(
        owner.query('UPDATE medication.administration_corrections SET note = NULL WHERE id = $1', [
          correction.id,
        ]),
      ).rejects.toMatchObject({ constraint: 'medication_history_immutable_ck' });

      const otherDefinitionId = uuidv7();
      await owner.query(
        `INSERT INTO medication.definitions
           (id, tenant_id, name, dosage_form, route, status, created_at, updated_at)
         VALUES ($1, $2, 'Other tenant medication', 'tablet', 'oral', 'active', $3, $3)`,
        [otherDefinitionId, otherTenantId, now],
      );
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const visibleDefinitions = await appRole.query<{ id: string }>(
        'SELECT id FROM medication.definitions ORDER BY id',
      );
      expect(visibleDefinitions.rows.map((row) => row.id)).toEqual([definitionId]);
      const visibleReconciliations = await appRole.query<{ id: string }>(
        'SELECT id FROM medication.reconciliations ORDER BY id',
      );
      expect(visibleReconciliations.rows.map((row) => row.id)).toEqual(
        [pendingReview.reconciliation.id, startedReconciliation.reconciliation.id, staleId].sort(),
      );
      const hiddenCrossTenantUpdate = await appRole.query(
        'UPDATE medication.definitions SET name = $1 WHERE tenant_id = $2 AND id = $3',
        ['Cross tenant change', otherTenantId, otherDefinitionId],
      );
      expect(hiddenCrossTenantUpdate.rowCount).toBe(0);
      await appRole.query('SAVEPOINT before_medication_cross_tenant_insert');
      await expect(
        appRole.query(
          `INSERT INTO medication.definitions
           (id, tenant_id, name, dosage_form, route, status, created_at, updated_at)
         VALUES ($1, $2, 'Cross tenant write', 'tablet', 'oral', 'active', $3, $3)`,
          [uuidv7(), otherTenantId, now],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK TO SAVEPOINT before_medication_cross_tenant_insert');
      await appRole.query('COMMIT');

      const revisionFacts = await owner.query<{ dose_amount: string; version: number }>(
        `SELECT dose_amount, version FROM medication.order_revisions
         WHERE tenant_id = $1 AND order_id = $2 AND version = 2`,
        [tenantId, scheduledOrder.order.id],
      );
      expect(revisionFacts.rows[0]).toMatchObject({ dose_amount: '1.000', version: 2 });
      const auditRows = await owner.query<{ action: string; metadata: Record<string, unknown> }>(
        'SELECT action, metadata FROM audit.audit_entries WHERE tenant_id = $1',
        [tenantId],
      );
      const outboxRows = await owner.query<{ event_type: string; event: unknown }>(
        'SELECT event_type, event FROM platform.outbox_messages WHERE tenant_id = $1',
        [tenantId],
      );
      const eventTypes = outboxRows.rows.map((row) => row.event_type);
      expect(eventTypes).toContain('medication_order.created');
      expect(eventTypes).toContain('medication_order.activated');
      expect(eventTypes).toContain('medication_order.changed');
      expect(eventTypes).toContain('medication_administration.recorded');
      expect(eventTypes).toContain('medication_administration.corrected');
      expect(eventTypes).toContain('medication_reconciliation.created');
      expect(eventTypes).toContain('medication_reconciliation.source_added');
      expect(eventTypes).toContain('medication_reconciliation.entry_added');
      expect(eventTypes).toContain('medication_reconciliation.reviewed');
      expect(eventTypes).toContain('medication_reconciliation.change_applied');
      expect(eventTypes).toContain('medication_reconciliation.completed');
      expect(eventTypes).toContain('medication_reconciliation.cancelled');
      const auditActions = auditRows.rows.map((row) => row.action);
      expect(auditActions).toContain('medication_reconciliation.created');
      expect(auditActions).toContain('medication_reconciliation.source_added');
      expect(auditActions).toContain('medication_reconciliation.entry_added');
      expect(auditActions).toContain('medication_reconciliation.compared');
      expect(auditActions).toContain('medication_reconciliation.change_applied');
      expect(auditActions).toContain('medication_reconciliation.completed');
      expect(auditActions).toContain('medication_reconciliation.cancelled');
      const serializedAuditAndEvents = JSON.stringify({
        audit: auditRows.rows,
        events: outboxRows.rows,
      });
      expect(serializedAuditAndEvents).not.toContain('Example medication');
      expect(serializedAuditAndEvents).not.toContain('Sensitive care note');
      expect(serializedAuditAndEvents).not.toContain('Sensitive external source note');
      expect(serializedAuditAndEvents).not.toContain('Discharge medication list');
      expect(serializedAuditAndEvents).not.toContain('Example ingredient');
      expect(serializedAuditAndEvents).not.toContain('doseAmount');
      expect(serializedAuditAndEvents).not.toContain('dose_amount');

      const forcedRls = await owner.query<{ relname: string; relforcerowsecurity: boolean }>(
        `SELECT relname, relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'medication' AND c.relkind = 'r' ORDER BY relname`,
      );
      expect(forcedRls.rows.length).toBeGreaterThanOrEqual(6);
      expect(forcedRls.rows.every((table) => table.relforcerowsecurity)).toBe(true);
    } finally {
      await appRole.query('ROLLBACK').catch(() => undefined);
      await appRole.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await database.close();
      await testDatabase.container.stop();
    }
  });
});

function principal(
  tenantId: string,
  userId: string,
  grants: PermissionGrant[],
): AuthorizationPrincipal {
  return { tenantId, userId, grants };
}

function tenantGrant(permission: PermissionGrant['permission'], tenantId: string): PermissionGrant {
  return { permission, scopeType: 'tenant', scopeId: tenantId };
}

function assignedGrant(permission: PermissionGrant['permission'], userId: string): PermissionGrant {
  return { permission, scopeType: 'assigned_clients', scopeId: userId };
}

function competencyEvaluator(
  employeeId: string,
  allowed: boolean,
): CompetencyPolicyEvaluator<DatabaseTransaction> {
  return {
    evaluate: async () =>
      allowed
        ? {
            allowed: true,
            policyId: uuidv7(),
            policyVersion: 1,
            employeeId,
            matchedQualificationIds: [],
            evaluatedAt: new Date(),
          }
        : { allowed: false, reasonCode: 'COMPETENCY_POLICY_NOT_CONFIGURED' },
  };
}

function administration(visitId: string) {
  return {
    visitId,
    outcome: 'administered' as const,
    actualDoseAmount: '1',
    actualDoseUnit: 'tablet' as const,
    reasonCode: null,
    administrationReason: null,
    note: null,
  };
}
