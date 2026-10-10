import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']).default('development');
const url = z.string().url();
const issuer = url.refine((value) => value.endsWith('/'), 'OIDC_ISSUER must end with /');

export type NodeEnvironment = z.infer<typeof nodeEnvironment>;

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  return schema.parse(source);
}

export function loadApiConfig(source: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      DATABASE_URL: url,
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: z.string().min(1),
      WEB_ORIGIN: url,
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      SCHEDULE_GENERATION_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(28),
      ROUTING_OSRM_URL: url.optional(),
      OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
    }),
    source,
  );
}

export function loadWebConfig(source: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      DATABASE_URL: url,
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: z.string().min(1),
      OIDC_CLIENT_SECRET: z.string().min(1),
      AUTH_SECRET: z.string().min(32),
      API_INTERNAL_URL: url,
      WEB_ORIGIN: url,
    }),
    source,
  );
}

export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      WORKER_DATABASE_URL: url,
      OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
      WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    }),
    source,
  );
}

export function loadStorageConfig(source: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      S3_ENDPOINT: url,
      S3_REGION: z.string().min(1),
      S3_BUCKET: z.string().min(1),
      S3_ACCESS_KEY: z.string().min(1),
      S3_SECRET_KEY: z.string().min(1),
      S3_FORCE_PATH_STYLE: z
        .enum(['true', 'false'])
        .default('true')
        .transform((value) => value === 'true'),
    }),
    source,
  );
}

export function loadMigrationConfig(source: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      MIGRATION_DATABASE_URL: url,
    }),
    source,
  );
}
