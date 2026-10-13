import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import type { Pool, PoolClient } from 'pg';
import { instrumentPoolQueries } from './index';

test('logs slow PostgreSQL statements without query parameters', async () => {
  const pool = new EventEmitter() as Pool;
  const events: Array<{ durationMs: number; query: string }> = [];
  const client = {
    query: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { rows: [] };
    },
  } as unknown as PoolClient;

  instrumentPoolQueries(pool, 1, (event) => events.push(event));
  pool.emit('connect', client);
  await client.query('select * from clients where id = $1', ['private-client-id']);

  expect(events).toHaveLength(1);
  expect(events[0]?.query).toBe('select * from clients where id = $1');
  expect(events[0]?.query).not.toContain('private-client-id');
  expect(events[0]?.durationMs).toBeGreaterThanOrEqual(1);
});

test('does not log statements below the configured threshold', async () => {
  const pool = new EventEmitter() as Pool;
  const events: Array<{ durationMs: number; query: string }> = [];
  const client = { query: async () => ({ rows: [] }) } as unknown as PoolClient;

  instrumentPoolQueries(pool, 1_000, (event) => events.push(event));
  pool.emit('connect', client);
  await client.query('select 1');

  expect(events).toHaveLength(0);
});
