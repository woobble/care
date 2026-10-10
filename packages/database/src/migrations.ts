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
  ],
  clients: ['0001_initial.sql', '0002_master_data.sql', '0003_scheduling_provider_reference.sql'],
  services: ['0001_catalog.sql', '0002_benefit_classification_and_prices.sql'],
  'service-agreements': ['0001_service_agreements.sql', '0002_scheduling_references.sql'],
  scheduling: ['0001_scheduling.sql'],
  'visit-execution': [
    '0001_visit_execution.sql',
    '0002_documentation_reference.sql',
    '0003_completed_services_immutable.sql',
  ],
  audit: ['0001_initial.sql', '0002_query_indexes.sql'],
  platform: ['0001_initial.sql', '0002_uuidv7_rekey.sql', '0003_retire_clinical_modules.sql'],
  'care-documentation': ['0001_care_documentation.sql'],
  'service-evidence': ['0001_service_evidence.sql'],
  benefits: ['0001_benefits.sql', '0002_bucket_rule_version.sql'],
  documents: ['0001_documents.sql', '0002_claim_summary.sql'],
  billing: ['0001_billing.sql', '0002_invoice_document_rendering.sql', '0003_claims.sql'],
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
}
