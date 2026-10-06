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
  organizations: ['0001_initial.sql'],
  identity: ['0001_initial.sql'],
  employees: ['0001_initial.sql'],
  clients: ['0001_initial.sql'],
  audit: ['0001_initial.sql'],
  platform: ['0001_initial.sql'],
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
}
