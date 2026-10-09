import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, test } from 'bun:test';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import type { AuthorizationPrincipal, CompetencyPolicyEvaluator, PermissionGrant } from '@care/permissions';
import { MedicationApplicationService } from '@care/medication';
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
    const clientId = uuidv7();
    const employeeId = uuidv7();
    const visitId = uuidv7();
    const now = new Date();
    const visitStart = new Date(now.getTime() - 2 * 60 * 60_000);
    const visitEnd = new Date(now.getTime() - 60 * 60_000);
    const validFrom = visitStart.toISOString().slice(0, 10);
    const anchorAt = new Date(visitStart.getTime() - 3 * 60 * 60_000).toISOString();
    const request = { requestId: uuidv7(), correlationId: uuidv7() };
    const auditContext = { ip: '127.0.0.1', userAgent: 'medication-integration-test' };
    const management = principal(tenantId, userId, [tenantGrant('medication.order.manage', tenantId)]);
    const caregiver = principal(tenantId, userId, [
      assignedGrant('medication.read', userId),
      assignedGrant('medication.administer', userId),
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
      const scheduledOrder = await medication.createOrder(management, clientId, {
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
      }, request, auditContext);
      expect(scheduledOrder.order).toMatchObject({ status: 'draft', version: 1 });
      const activatedOrder = await medication.transitionOrder(
        management, scheduledOrder.order.id, 1, 'active', request, auditContext,
      );
      expect(activatedOrder.order).toMatchObject({ status: 'active', version: 2 });

      await expect(medication.administrationsForVisit(unauthorizedCaregiver, visitId))
        .rejects.toMatchObject({ code: 'MEDICATION_ADMINISTRATION_NOT_AUTHORIZED' });
      const view = await medication.administrationsForVisit(caregiver, visitId);
      const due = view.due.filter((item) => item.scheduledAt.getTime() <= now.getTime());
      expect(due.length).toBeGreaterThanOrEqual(2);

      const deniedMedication = new MedicationApplicationService(
        unitOfWork,
        new DrizzleAuditWriter(),
        new DrizzleOutboxRepository(database.db),
        competencyEvaluator(employeeId, false),
      );
      await expect(deniedMedication.recordOccurrence(caregiver, due[0]!.occurrenceId, administration(visitId), request, auditContext))
        .rejects.toMatchObject({ code: 'MEDICATION_COMPETENCY_REQUIRED', status: 403 });

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
        medication.recordOccurrence(caregiver, due[1]!.occurrenceId, administration(visitId), request, auditContext),
        medication.recordOccurrence(caregiver, due[1]!.occurrenceId, administration(visitId), request, auditContext),
      ]);
      expect(concurrentAttempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(concurrentAttempts.filter((item) => item.status === 'rejected')).toHaveLength(1);
      const duplicateError = concurrentAttempts.find((item) => item.status === 'rejected');
      expect(duplicateError).toMatchObject({ reason: { code: 'MEDICATION_ADMINISTRATION_ALREADY_RECORDED' } });

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

      const prnOrder = await medication.createOrder(management, clientId, {
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
        schedule: { type: 'as_needed', indication: 'Pain', maximumDoseAmount: '1', maximumAdministrations: 1, frequencyWindowMinutes: 1440 },
      }, request, auditContext);
      await medication.transitionOrder(management, prnOrder.order.id, 1, 'active', request, auditContext);
      const prnInput = { ...administration(visitId), administrationReason: 'Client reports pain' };
      const prnRecord = await medication.recordPrn(caregiver, prnOrder.order.id, prnInput, request, auditContext);
      expect(prnRecord.outcome).toBe('administered');
      await expect(medication.recordPrn(caregiver, prnOrder.order.id, prnInput, request, auditContext))
        .rejects.toMatchObject({ code: 'MEDICATION_PRN_LIMIT_EXCEEDED', status: 409 });

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
      expect(correction).toMatchObject({ recordId: firstRecord.id, version: 1, correctedByEmployeeId: employeeId });

      const currentDate = now.toISOString().slice(0, 10);
      const clientHistory = await medication.administrationsForClient(correctionPrincipal, clientId, {
        from: validFrom,
        until: currentDate,
      });
      const correctedRecord = clientHistory.history.find((item) => item.id === firstRecord.id);
      expect(correctedRecord).toMatchObject({
        outcome: 'administered',
        orderVersion: 2,
        currentCorrection: { outcome: 'not_administered', correctionReason: 'Outcome was entered in error' },
      });
      expect(correctedRecord?.medication.name).toBe('Example medication');

      await expect(owner.query('UPDATE medication.administration_records SET note = NULL WHERE id = $1', [firstRecord.id]))
        .rejects.toMatchObject({ constraint: 'medication_history_immutable_ck' });
      await expect(owner.query('UPDATE medication.administration_corrections SET note = NULL WHERE id = $1', [correction.id]))
        .rejects.toMatchObject({ constraint: 'medication_history_immutable_ck' });

      const otherDefinitionId = uuidv7();
      await owner.query(
        `INSERT INTO medication.definitions
           (id, tenant_id, name, dosage_form, route, status, created_at, updated_at)
         VALUES ($1, $2, 'Other tenant medication', 'tablet', 'oral', 'active', $3, $3)`,
        [otherDefinitionId, otherTenantId, now],
      );
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const visibleDefinitions = await appRole.query<{ id: string }>('SELECT id FROM medication.definitions ORDER BY id');
      expect(visibleDefinitions.rows.map((row) => row.id)).toEqual([definitionId]);
      const hiddenCrossTenantUpdate = await appRole.query(
        'UPDATE medication.definitions SET name = $1 WHERE tenant_id = $2 AND id = $3',
        ['Cross tenant change', otherTenantId, otherDefinitionId],
      );
      expect(hiddenCrossTenantUpdate.rowCount).toBe(0);
      await appRole.query('SAVEPOINT before_medication_cross_tenant_insert');
      await expect(appRole.query(
        `INSERT INTO medication.definitions
           (id, tenant_id, name, dosage_form, route, status, created_at, updated_at)
         VALUES ($1, $2, 'Cross tenant write', 'tablet', 'oral', 'active', $3, $3)`,
        [uuidv7(), otherTenantId, now],
      )).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK TO SAVEPOINT before_medication_cross_tenant_insert');
      await appRole.query('COMMIT');

      const revisionFacts = await owner.query<{ dose_amount: string; version: number }>(
        `SELECT dose_amount, version FROM medication.order_revisions
         WHERE tenant_id = $1 AND order_id = $2 AND version = 2`,
        [tenantId, scheduledOrder.order.id],
      );
      expect(revisionFacts.rows[0]).toMatchObject({ dose_amount: '1.000', version: 2 });
      const auditRows = await owner.query<{ metadata: Record<string, unknown> }>(
        'SELECT metadata FROM audit.audit_entries WHERE tenant_id = $1', [tenantId],
      );
      const outboxRows = await owner.query<{ event_type: string; event: unknown }>(
        'SELECT event_type, event FROM platform.outbox_messages WHERE tenant_id = $1', [tenantId],
      );
      const eventTypes = outboxRows.rows.map((row) => row.event_type);
      expect(eventTypes).toContain('medication_order.created');
      expect(eventTypes).toContain('medication_order.activated');
      expect(eventTypes).toContain('medication_order.changed');
      expect(eventTypes).toContain('medication_administration.recorded');
      expect(eventTypes).toContain('medication_administration.corrected');
      const serializedAuditAndEvents = JSON.stringify({ audit: auditRows.rows, events: outboxRows.rows });
      expect(serializedAuditAndEvents).not.toContain('Example medication');
      expect(serializedAuditAndEvents).not.toContain('Sensitive care note');

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

function competencyEvaluator(employeeId: string, allowed: boolean): CompetencyPolicyEvaluator<DatabaseTransaction> {
  return {
    evaluate: async () => allowed
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
