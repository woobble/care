import { Pool } from 'pg';
import type { PoolClient } from 'pg';
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

export type SlowQueryEvent = {
  durationMs: number;
  query: string;
};

export type DatabaseOptions = {
  slowQueryThresholdMs?: number;
  onSlowQuery?: (event: SlowQueryEvent) => void;
};

export function createDatabase<TSchema extends Record<string, unknown>>(
  connectionString: string,
  schema: TSchema,
  options: DatabaseOptions = {},
) {
  const pool = new Pool({ connectionString, max: 10, application_name: 'care-platform' });
  if (options.slowQueryThresholdMs !== undefined && options.onSlowQuery) {
    instrumentPoolQueries(pool, options.slowQueryThresholdMs, options.onSlowQuery);
  }
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}

export function instrumentPoolQueries(
  pool: Pool,
  thresholdMs: number,
  onSlowQuery: (event: SlowQueryEvent) => void,
): void {
  pool.on('connect', (client) => instrumentClientQueries(client, thresholdMs, onSlowQuery));
}

function instrumentClientQueries(
  client: PoolClient,
  thresholdMs: number,
  onSlowQuery: (event: SlowQueryEvent) => void,
): void {
  const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((...args: unknown[]) => {
    const startedAt = performance.now();
    const query = queryText(args[0]);
    const reportIfSlow = () => {
      const durationMs = performance.now() - startedAt;
      if (durationMs >= thresholdMs) {
        onSlowQuery({ durationMs: Math.round(durationMs * 10) / 10, query });
      }
    };

    const callbackIndex = args.findIndex((argument) => typeof argument === 'function');
    if (callbackIndex !== -1) {
      const callback = args[callbackIndex] as (...callbackArgs: unknown[]) => unknown;
      args[callbackIndex] = (...callbackArgs: unknown[]) => {
        reportIfSlow();
        return callback(...callbackArgs);
      };
      return originalQuery(...args);
    }

    const result = originalQuery(...args);
    if (isPromiseLike(result)) {
      return result.then(
        (value) => {
          reportIfSlow();
          return value;
        },
        (error: unknown) => {
          reportIfSlow();
          throw error;
        },
      );
    }
    return result;
  }) as typeof client.query;
}

function queryText(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 400);
  if (typeof value === 'object' && value !== null && 'text' in value) {
    const text = value.text;
    if (typeof text === 'string') return text.slice(0, 400);
  }
  return 'unknown statement';
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
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
