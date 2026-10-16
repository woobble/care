// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading migration configuration
import '@care/config/load-env';
import { Client } from 'pg';

import { loadMigrationConfig } from '@care/config';
import { applyMigrations } from '@care/database/migrations';

const { MIGRATION_DATABASE_URL } = loadMigrationConfig();
const client = new Client({
  connectionString: MIGRATION_DATABASE_URL,
  application_name: 'care-migrator',
});

try {
  await client.connect();
  await applyMigrations(client);
} finally {
  await client.end();
}
