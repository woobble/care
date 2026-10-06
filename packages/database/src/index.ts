import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

// The transaction type erases a composed schema at module ports. Table ownership stays in modules.
export type DatabaseTransaction = Parameters<
  Parameters<NodePgDatabase<Record<string, unknown>>['transaction']>[0]
>[0];

export interface UnitOfWork {
  transaction<T>(
    options: { tenantId?: string },
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
}

export function createDatabase<TSchema extends Record<string, unknown>>(
  connectionString: string,
  schema: TSchema,
) {
  const pool = new Pool({ connectionString, max: 10, application_name: 'care-platform' });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}

export function createUnitOfWork(db: NodePgDatabase<Record<string, unknown>>): UnitOfWork {
  return {
    transaction<T>(
      options: { tenantId?: string },
      operation: (transaction: DatabaseTransaction) => Promise<T>,
    ) {
      return db.transaction(async (transaction) => {
        if (options.tenantId) {
          await transaction.execute(
            sql`select set_config('app.tenant_id', ${options.tenantId}, true)`,
          );
        }
        return operation(transaction);
      });
    },
  };
}
