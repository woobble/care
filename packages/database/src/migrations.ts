import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Client } from 'pg';

export interface MigrationFile {
  module: string;
  name: string;
  path: string;
}

const migrations = {
  organizations: [
    '0001_initial.sql',
    '0002_tenant_integrity.sql',
    '0003_operational_structure.sql',
    '0004_scheduling_timezone.sql',
    '0005_worker_tenant_scan.sql',
    '0006_worker_deadline_read.sql',
    '0007_structure_search_indexes.sql',
  ],
  identity: [
    '0001_initial.sql',
    '0002_tenant_access.sql',
    '0003_membership_pending_default.sql',
    '0004_team_membership_scope.sql',
  ],
  employees: [
    '0001_initial.sql',
    '0002_user_link_integrity.sql',
    '0003_employee_management.sql',
    '0004_employee_qualification_lifecycle.sql',
    '0005_employee_qualification_expiry_index.sql',
    '0006_operations_worker_assignment_validation.sql',
    '0007_worker_deadline_read.sql',
  ],
  clients: [
    '0001_initial.sql',
    '0002_master_data.sql',
    '0003_scheduling_provider_reference.sql',
    '0004_worker_deadline_read.sql',
    '0005_client_search_indexes.sql',
  ],
  services: ['0001_catalog.sql', '0002_benefit_classification_and_prices.sql'],
  'service-agreements': [
    '0001_service_agreements.sql',
    '0002_scheduling_references.sql',
    '0003_worker_deadline_read.sql',
  ],
  scheduling: [
    '0001_scheduling.sql',
    '0002_advanced_planning.sql',
    '0003_operational_planning.sql',
    '0004_calendar_subscriptions.sql',
  ],
  'visit-execution': [
    '0001_visit_execution.sql',
    '0002_documentation_reference.sql',
    '0003_completed_services_immutable.sql',
  ],
  audit: ['0001_initial.sql', '0002_query_indexes.sql', '0003_worker_audit_writer.sql'],
  platform: [
    '0001_initial.sql',
    '0002_uuidv7_rekey.sql',
    '0003_retire_clinical_modules.sql',
    '0004_worker_outbox_writer.sql',
    '0005_worker_health.sql',
  ],
  'care-documentation': ['0001_care_documentation.sql'],
  'service-evidence': ['0001_service_evidence.sql'],
  benefits: ['0001_benefits.sql', '0002_bucket_rule_version.sql', '0003_worker_deadline_read.sql'],
  documents: ['0001_documents.sql', '0002_claim_summary.sql', '0003_artifact_worklist.sql'],
  billing: [
    '0001_billing.sql',
    '0002_invoice_document_rendering.sql',
    '0003_claims.sql',
    '0004_worker_deadline_read.sql',
    '0005_payer_search_indexes.sql',
  ],
  operations: [
    '0001_operations.sql',
    '0002_operations_assignee_scope.sql',
    '0003_exception_occurrences.sql',
    '0004_communication_task_source.sql',
    '0005_onboarding_exception_category.sql',
    '0006_recurring_tasks.sql',
    '0007_deadline_projection.sql',
    '0008_deadline_projection_cursors.sql',
    '0009_visit_execution_exception_source.sql',
    '0010_worker_deadline_projection.sql',
  ],
  communications: [
    '0001_communications.sql',
    '0002_communication_task_reference.sql',
    '0003_prospect_interactions.sql',
  ],
  onboarding: [
    '0001_onboarding.sql',
    '0002_onboarding_readiness.sql',
    '0003_worker_deadline_read.sql',
  ],
} as const;
const migrationsRoot = resolve(import.meta.dirname, '../../../modules');

export const migrationFiles: MigrationFile[] = Object.entries(migrations).flatMap(
  ([module, names]) =>
    names.map((name) => ({
      module,
      name,
      path: resolve(migrationsRoot, module, 'migrations', name),
    })),
);

export async function applyMigrations(client: Client): Promise<void> {
  const lockKeys: [number, number] = [1_481_851_208, 1];
  await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys);
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS platform');
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.migration_registry (
        module text NOT NULL,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (module, name)
      )
    `);

    // Run in declaration order because later migrations depend on earlier schemas.
    // The session lock serializes separate deploy and operator migration commands.
    // oxlint-disable no-await-in-loop
    for (const migration of migrationFiles) {
      const source = await readFile(migration.path, 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM platform.migration_registry WHERE module = $1 AND name = $2',
        [migration.module, migration.name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration changed: ${migration.module}/${migration.name}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(source);
        await client.query(
          'INSERT INTO platform.migration_registry(module, name, checksum) VALUES ($1, $2, $3)',
          [migration.module, migration.name, checksum],
        );
        await client.query('COMMIT');
        process.stdout.write(`Applied ${migration.module}/${migration.name}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    // oxlint-enable no-await-in-loop
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys);
  }
}
