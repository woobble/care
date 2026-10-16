import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { applyMigrations } from '@care/database/migrations';

export async function startCareTestDatabase() {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('care')
    .withUsername('care_owner')
    .withPassword('care_owner_test')
    .start();
  const migrationUrl = container.getConnectionUri();
  const owner = new Client({ connectionString: migrationUrl });

  try {
    await owner.connect();
    await owner.query(`
      CREATE ROLE care_app LOGIN PASSWORD 'care_app_test';
      CREATE ROLE care_worker LOGIN PASSWORD 'care_worker_test';
    `);
    await applyMigrations(owner);
  } catch (error) {
    await container.stop();
    throw error;
  } finally {
    await owner.end();
  }

  return {
    container,
    migrationUrl,
    appUrl: connectionUrl(migrationUrl, 'care_app', 'care_app_test'),
    workerUrl: connectionUrl(migrationUrl, 'care_worker', 'care_worker_test'),
  };
}

function connectionUrl(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
