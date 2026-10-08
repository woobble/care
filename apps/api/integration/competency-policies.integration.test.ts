import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { describe, expect, test } from 'bun:test';
import { DrizzleAuditWriter } from '@care/audit';
import { createDatabase, createUnitOfWork } from '@care/database';
import { startCareTestDatabase } from '@care/testing';
import {
  CompetencyPolicyVersionConflictError,
  ProfessionalCompetencyPolicyApplicationService,
} from '@care/competency-policies';
import type { AuthorizationPrincipal, CompetencyOperation } from '@care/permissions';
import { DrizzleOutboxRepository } from '@care/platform';
import { databaseSchema } from '../src/database/schema';

describe('professional competency policies PostgreSQL integration', () => {
  test('isolates tenants, preserves versions, evaluates qualification lifecycle, and serializes concurrent changes', async () => {
    const testDatabase = await startCareTestDatabase();
    const owner = new Client({ connectionString: testDatabase.migrationUrl });
    const appRole = new Client({ connectionString: testDatabase.appUrl });
    const database = createDatabase(testDatabase.appUrl, databaseSchema);
    const unitOfWork = createUnitOfWork(database.db);
    const policies = new ProfessionalCompetencyPolicyApplicationService(
      unitOfWork,
      new DrizzleAuditWriter(),
      new DrizzleOutboxRepository(database.db),
    );
    const tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const userId = uuidv7();
    const unlinkedUserId = uuidv7();
    const membershipId = uuidv7();
    const unlinkedMembershipId = uuidv7();
    const employeeId = uuidv7();
    const qualificationId = uuidv7();
    const otherQualificationId = uuidv7();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const request = { requestId: uuidv7(), correlationId: uuidv7() };
    const auditContext = { ip: '127.0.0.1', userAgent: 'competency-policy-integration-test' };
    const principal = createPrincipal(tenantId, userId);
    const otherPrincipal = createPrincipal(otherTenantId, uuidv7());

    try {
      await owner.connect();
      await appRole.connect();
      await owner.query(
        `INSERT INTO organizations.tenants (id, name, slug)
         VALUES ($1, 'Competency integration tenant', $2), ($3, 'Other tenant', $4)`,
        [tenantId, `competency-${tenantId}`, otherTenantId, `other-${otherTenantId}`],
      );
      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [userId]);
      await owner.query('INSERT INTO identity.users (id) VALUES ($1)', [unlinkedUserId]);
      await owner.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $3, 'active')`,
        [membershipId, userId, tenantId, unlinkedMembershipId, unlinkedUserId],
      );
      await owner.query(
        `INSERT INTO employees.employees (id, tenant_id, user_id, first_name, last_name)
         VALUES ($1, $2, $3, 'Integration', 'Author')`,
        [employeeId, tenantId, userId],
      );
      await owner.query(
        `INSERT INTO employees.qualification_definitions (id, tenant_id, name, code, status)
         VALUES ($1, $2, 'Registered care professional', 'RCP', 'active'),
                ($3, $4, 'Other tenant professional', 'OTP', 'active')`,
        [qualificationId, tenantId, otherQualificationId, otherTenantId],
      );

      const noForeignTenantPolicies = await policies.list(otherPrincipal);
      expect(
        noForeignTenantPolicies.operations.every((operation) => operation.policyId === null),
      ).toBe(true);
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.evaluate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_POLICY_NOT_CONFIGURED',
      });

      await policies.configureDraft(
        principal,
        'care_plan.evaluate',
        draftInput(0, qualificationId, 'Evaluation policy'),
        request,
        auditContext,
      );
      await policies.activate(principal, 'care_plan.evaluate', 1, request, auditContext);

      const draft = await policies.configureDraft(
        principal,
        'care_plan.activate',
        draftInput(0, qualificationId, 'Initial policy'),
        request,
        auditContext,
      );
      expect(
        draft.operations.find((operation) => operation.operationKey === 'care_plan.activate'),
      ).toMatchObject({ latestVersion: 1, activeVersion: null });
      await policies.activate(principal, 'care_plan.activate', 1, request, auditContext);

      const policyId = draft.operations.find(
        (operation) => operation.operationKey === 'care_plan.activate',
      )?.policyId;
      expect(policyId).not.toBeNull();
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [otherTenantId]);
      expect(
        (
          await appRole.query(
            'SELECT id FROM "authorization".professional_competency_policies WHERE id = $1',
            [policyId],
          )
        ).rowCount,
      ).toBe(0);
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      expect(
        (
          await appRole.query(
            'SELECT id FROM "authorization".professional_competency_policies WHERE id = $1',
            [policyId],
          )
        ).rowCount,
      ).toBe(1);
      await appRole.query('SAVEPOINT before_competency_cross_tenant_write');
      await expect(
        appRole.query(
          `INSERT INTO "authorization".professional_competency_policies
             (id, tenant_id, operation_key)
           VALUES ($1, $2, 'care_plan.activate')`,
          [uuidv7(), otherTenantId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await appRole.query('ROLLBACK TO SAVEPOINT before_competency_cross_tenant_write');
      await appRole.query('COMMIT');

      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_QUALIFICATION_MISSING',
      });
      expect(
        await evaluate(policies, unitOfWork, tenantId, unlinkedUserId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_EMPLOYEE_LINK_REQUIRED',
      });

      await owner.query(
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv7(), tenantId, employeeId, qualificationId, today, tomorrow],
      );
      const allowed = await evaluate(
        policies,
        unitOfWork,
        tenantId,
        userId,
        'care_plan.activate',
        now,
      );
      expect(allowed).toMatchObject({
        allowed: true,
        policyVersion: 1,
        employeeId,
        matchedQualificationIds: [qualificationId],
      });
      await owner.query(
        "UPDATE employees.employees SET status = 'inactive' WHERE tenant_id = $1 AND id = $2",
        [tenantId, employeeId],
      );
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_EMPLOYEE_INACTIVE',
      });
      await owner.query(
        "UPDATE employees.employees SET status = 'active' WHERE tenant_id = $1 AND id = $2",
        [tenantId, employeeId],
      );
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.evaluate', now),
      ).toMatchObject({ allowed: true, policyVersion: 1, employeeId });

      await owner.query(
        `UPDATE employees.employee_qualifications
         SET valid_from = $4, valid_until = $4, updated_at = now()
         WHERE tenant_id = $1 AND employee_id = $2 AND qualification_id = $3 AND status = 'active'`,
        [tenantId, employeeId, qualificationId, yesterday],
      );
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_QUALIFICATION_EXPIRED',
      });

      await owner.query(
        `UPDATE employees.employee_qualifications
         SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND employee_id = $2 AND qualification_id = $3 AND status = 'active'`,
        [tenantId, employeeId, qualificationId],
      );
      const revoked = await owner.query<{ status: string; revoked_at: Date | null }>(
        `SELECT status, revoked_at FROM employees.employee_qualifications
         WHERE tenant_id = $1 AND employee_id = $2 AND qualification_id = $3`,
        [tenantId, employeeId, qualificationId],
      );
      expect(revoked.rows).toHaveLength(1);
      expect(revoked.rows[0]).toMatchObject({ status: 'revoked' });
      expect(revoked.rows[0]?.revoked_at).toBeInstanceOf(Date);
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_QUALIFICATION_MISSING',
      });

      await owner.query(
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [uuidv7(), tenantId, employeeId, qualificationId, today],
      );

      const concurrentDrafts = await Promise.allSettled([
        policies.configureDraft(
          principal,
          'care_plan.activate',
          draftInput(1, qualificationId, 'Concurrent draft A'),
          { ...request, requestId: uuidv7() },
          auditContext,
        ),
        policies.configureDraft(
          principal,
          'care_plan.activate',
          draftInput(1, qualificationId, 'Concurrent draft B'),
          { ...request, requestId: uuidv7() },
          auditContext,
        ),
      ]);
      expect(concurrentDrafts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const draftConflict = concurrentDrafts.find((result) => result.status === 'rejected');
      expect(draftConflict?.status).toBe('rejected');
      if (draftConflict?.status === 'rejected') {
        expect(draftConflict.reason).toBeInstanceOf(CompetencyPolicyVersionConflictError);
      }

      const versionTwoView = await policies.list(principal);
      const versionTwo = versionTwoView.operations.find(
        (operation) => operation.operationKey === 'care_plan.activate',
      )?.latestVersion;
      expect(versionTwo).toBe(2);
      const versionTwoId = versionTwoView.operations
        .find((operation) => operation.operationKey === 'care_plan.activate')
        ?.versions.find((version) => version.version === 2)?.id;
      expect(versionTwoId).toBeDefined();
      await expect(
        owner.query(
          `INSERT INTO "authorization".professional_competency_policy_requirements
             (id, tenant_id, policy_version_id, qualification_definition_id)
           VALUES ($1, $2, $3, $4)`,
          [uuidv7(), tenantId, versionTwoId, otherQualificationId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const concurrentActivations = await Promise.allSettled([
        policies.activate(principal, 'care_plan.activate', 2, request, auditContext),
        policies.activate(
          principal,
          'care_plan.activate',
          2,
          { ...request, requestId: uuidv7() },
          auditContext,
        ),
      ]);
      expect(concurrentActivations.filter((result) => result.status === 'fulfilled')).toHaveLength(
        1,
      );
      const activationConflict = concurrentActivations.find(
        (result) => result.status === 'rejected',
      );
      expect(activationConflict?.status).toBe('rejected');
      if (activationConflict?.status === 'rejected') {
        expect(activationConflict.reason).toBeInstanceOf(CompetencyPolicyVersionConflictError);
      }

      const activeVersions = await policies.list(principal);
      expect(
        activeVersions.operations.find(
          (operation) => operation.operationKey === 'care_plan.activate',
        ),
      ).toMatchObject({ latestVersion: 2, activeVersion: 2 });
      expect(
        await unitOfWork.transaction({ tenantId }, (transaction) =>
          policies.isQualificationUsedByActivePolicy(transaction, tenantId, qualificationId),
        ),
      ).toBe(true);

      const heldQualificationDecision = evaluateAndHold(
        policies,
        unitOfWork,
        tenantId,
        userId,
        'care_plan.activate',
        now,
      );
      expect(await heldQualificationDecision.ready).toMatchObject({
        allowed: true,
        policyVersion: 2,
      });
      await appRole.query('BEGIN');
      await appRole.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const concurrentRevocation = appRole.query(
        `UPDATE employees.employee_qualifications
         SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND employee_id = $2 AND qualification_id = $3 AND status = 'active'`,
        [tenantId, employeeId, qualificationId],
      );
      try {
        await waitForBlockedQuery(owner, 'employee_qualifications');
      } finally {
        heldQualificationDecision.release();
      }
      expect(await heldQualificationDecision.completion).toMatchObject({
        allowed: true,
        policyVersion: 2,
      });
      await concurrentRevocation;
      await appRole.query('COMMIT');
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_QUALIFICATION_MISSING',
      });
      await owner.query(
        `INSERT INTO employees.employee_qualifications
           (id, tenant_id, employee_id, qualification_id, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [uuidv7(), tenantId, employeeId, qualificationId, today],
      );

      const heldPolicyDecision = evaluateAndHold(
        policies,
        unitOfWork,
        tenantId,
        userId,
        'care_plan.activate',
        now,
      );
      expect(await heldPolicyDecision.ready).toMatchObject({
        allowed: true,
        policyVersion: 2,
      });
      const concurrentPolicyDeactivation = policies.deactivate(
        principal,
        'care_plan.activate',
        request,
        auditContext,
      );
      try {
        await waitForBlockedQuery(owner, 'professional_competency_policy_versions');
      } finally {
        heldPolicyDecision.release();
      }
      expect(await heldPolicyDecision.completion).toMatchObject({
        allowed: true,
        policyVersion: 2,
      });
      await concurrentPolicyDeactivation;
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.activate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_POLICY_INACTIVE',
      });
      expect(
        await unitOfWork.transaction({ tenantId }, (transaction) =>
          policies.isQualificationUsedByActivePolicy(transaction, tenantId, qualificationId),
        ),
      ).toBe(true);
      await policies.deactivate(principal, 'care_plan.evaluate', request, auditContext);
      expect(
        await evaluate(policies, unitOfWork, tenantId, userId, 'care_plan.evaluate', now),
      ).toMatchObject({
        allowed: false,
        reasonCode: 'COMPETENCY_POLICY_INACTIVE',
      });
      expect(
        await unitOfWork.transaction({ tenantId }, (transaction) =>
          policies.isQualificationUsedByActivePolicy(transaction, tenantId, qualificationId),
        ),
      ).toBe(false);

      const auditCount = await owner.query<{ count: string }>(
        `SELECT count(*) FROM audit.audit_entries
         WHERE tenant_id = $1 AND resource_type = 'competency_policy'`,
        [tenantId],
      );
      const outboxCount = await owner.query<{ count: string }>(
        `SELECT count(*) FROM platform.outbox_messages
         WHERE tenant_id = $1 AND event_type LIKE 'competency_policy.%'`,
        [tenantId],
      );
      expect(Number(auditCount.rows[0]?.count)).toBe(8);
      expect(Number(outboxCount.rows[0]?.count)).toBe(8);
    } finally {
      await appRole.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await database.close();
      await testDatabase.container.stop();
    }
  });
});

function createPrincipal(tenantId: string, userId: string): AuthorizationPrincipal {
  return {
    tenantId,
    userId,
    grants: [
      { permission: 'competency_policy.read', scopeType: 'tenant', scopeId: tenantId },
      { permission: 'competency_policy.manage', scopeType: 'tenant', scopeId: tenantId },
    ],
  };
}

function draftInput(expectedVersion: number, qualificationId: string, name: string) {
  return {
    expectedVersion,
    name,
    description: null,
    requirementMode: 'ALL' as const,
    qualificationDefinitionIds: [qualificationId],
  };
}

function evaluate(
  policies: ProfessionalCompetencyPolicyApplicationService,
  unitOfWork: ReturnType<typeof createUnitOfWork>,
  tenantId: string,
  userId: string,
  operation: CompetencyOperation,
  effectiveAt: Date,
) {
  return unitOfWork.transaction({ tenantId }, (transaction) =>
    policies.evaluate(transaction, { tenantId, userId, operation, effectiveAt }),
  );
}

function evaluateAndHold(
  policies: ProfessionalCompetencyPolicyApplicationService,
  unitOfWork: ReturnType<typeof createUnitOfWork>,
  tenantId: string,
  userId: string,
  operation: CompetencyOperation,
  effectiveAt: Date,
) {
  let release!: () => void;
  let ready!: (result: Awaited<ReturnType<typeof evaluate>>) => void;
  let rejectReady!: (error: unknown) => void;
  const readyPromise = new Promise<Awaited<ReturnType<typeof evaluate>>>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completion = unitOfWork.transaction({ tenantId }, async (transaction) => {
    try {
      const result = await policies.evaluate(transaction, {
        tenantId,
        userId,
        operation,
        effectiveAt,
      });
      ready(result);
      await hold;
      return result;
    } catch (error) {
      rejectReady(error);
      throw error;
    }
  });
  return { ready: readyPromise, completion, release };
}

async function waitForBlockedQuery(owner: Client, queryFragment: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = await owner.query(
      `SELECT pid FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid() AND query LIKE $1
       LIMIT 1`,
      [`%${queryFragment}%`],
    );
    if (blocked.rowCount === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Query containing "${queryFragment}" did not wait on a database lock`);
}
