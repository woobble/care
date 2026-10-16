import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']).default('development');
const url = z.string().url();
const httpUrl = url.refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const postgresUrl = url.refine(
  (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
  'Expected a PostgreSQL connection URL',
);
const issuer = url.refine((value) => value.endsWith('/'), 'OIDC_ISSUER must end with /');
const optionalHttpUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  httpUrl.optional(),
);
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), url.optional());
const routingProbe = z.string().refine((value) => {
  const [longitudePart, latitudePart] = value.split(',');
  if (!longitudePart?.trim() || !latitudePart?.trim()) return false;
  const longitude = Number(longitudePart);
  const latitude = Number(latitudePart);
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}, 'Routing probe must be longitude,latitude within WGS84 bounds');
const optionalRoutingProbe = z.preprocess(
  (value) => (value === '' ? undefined : value),
  routingProbe.optional(),
);

const secretFileBackedVariables = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'WORKER_DATABASE_URL',
  'OIDC_CLIENT_SECRET',
  'AUTH_SECRET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_INIT_ACCESS_KEY',
  'S3_INIT_SECRET_KEY',
  'AUTHENTIK_SECRET_KEY',
  'POSTGRES_PASSWORD',
  'CARE_APP_PASSWORD',
  'CARE_WORKER_PASSWORD',
  'AUTHENTIK_BOOTSTRAP_PASSWORD',
] as const;

export type NodeEnvironment = z.infer<typeof nodeEnvironment>;

/** Resolve Docker Compose secret mounts without ever including their contents in errors. */
export function resolveSecretFiles(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...source };
  for (const variable of secretFileBackedVariables) {
    const path = source[`${variable}_FILE`];
    if (source[variable] !== undefined || !path) continue;
    try {
      resolved[variable] = readFileSync(path, 'utf8').replace(/\r?\n+$/, '');
    } catch {
      throw new Error(`Invalid configuration: ${variable}_FILE cannot be read.`);
    }
  }
  return resolved;
}

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const variables = Array.from(
    new Set(result.error.issues.map((issue) => issue.path.join('.') || 'environment')),
  );
  throw new Error(`Invalid configuration for: ${variables.join(', ')}.`);
}

function rejectDevelopmentSecret(name: string, value: string): void {
  if (
    /(?:dev[-_]?only|build[-_]?only|replace[-_]?with|replace[-_]?before[-_]?deployment|change[-_]?me|local-admin-password|care-local-client-secret)/i.test(
      value,
    ) ||
    value === 'care-s3'
  ) {
    throw new Error(`Invalid production configuration: replace the development value for ${name}.`);
  }
}

function isPlaceholderHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'example' ||
    host.endsWith('.example') ||
    host === 'example.com' ||
    host.endsWith('.example.com') ||
    host === 'example.net' ||
    host.endsWith('.example.net') ||
    host === 'example.org' ||
    host.endsWith('.example.org') ||
    host.endsWith('.test') ||
    host === 'test' ||
    host === 'invalid' ||
    host.endsWith('.invalid')
  );
}

function productionUrl(name: string, value: string, requireHttps: boolean): URL {
  const parsed = new URL(value);
  const localHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '0.0.0.0' ||
    /^127\./.test(parsed.hostname);
  if (localHost || isPlaceholderHostname(parsed.hostname)) {
    throw new Error(
      `Invalid production configuration: ${name} must use a configured deployment host.`,
    );
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error(`Invalid production configuration: ${name} must use HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      `Invalid production configuration: ${name} cannot include URL credentials or query data.`,
    );
  }
  return parsed;
}

function assertProductionDatabase(name: string, value: string): void {
  const parsed = new URL(value);
  const localHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '0.0.0.0' ||
    /^127\./.test(parsed.hostname);
  if (localHost || isPlaceholderHostname(parsed.hostname)) {
    throw new Error(
      `Invalid production configuration: ${name} must use a configured database host.`,
    );
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`Invalid production configuration: ${name} must use PostgreSQL.`);
  }
  if (!parsed.username || !parsed.password) {
    throw new Error(`Invalid production configuration: ${name} must include database credentials.`);
  }
  if (parsed.password) rejectDevelopmentSecret(name, decodeURIComponent(parsed.password));
}

function assertProductionApi(config: {
  NODE_ENV: NodeEnvironment;
  DATABASE_URL: string;
  OIDC_ISSUER: string;
  WEB_ORIGIN: string;
  TRUSTED_PROXY_HOPS: number;
  ROUTING_OSRM_URL?: string | undefined;
}): void {
  if (config.NODE_ENV !== 'production') return;
  assertProductionDatabase('DATABASE_URL', config.DATABASE_URL);
  productionUrl('OIDC_ISSUER', config.OIDC_ISSUER, true);
  productionUrl('WEB_ORIGIN', config.WEB_ORIGIN, true);
  if (config.ROUTING_OSRM_URL) {
    const routing = new URL(config.ROUTING_OSRM_URL);
    if (routing.hostname === 'osrm') {
      if (routing.username || routing.password || routing.search || routing.hash) {
        throw new Error(
          'Invalid production configuration: ROUTING_OSRM_URL cannot include credentials or query data.',
        );
      }
    } else {
      productionUrl('ROUTING_OSRM_URL', config.ROUTING_OSRM_URL, true);
    }
  }
  if (config.TRUSTED_PROXY_HOPS < 1) {
    throw new Error('Invalid production configuration: TRUSTED_PROXY_HOPS must be at least 1.');
  }
}

function assertProductionWeb(config: {
  NODE_ENV: NodeEnvironment;
  DATABASE_URL: string;
  OIDC_ISSUER: string;
  OIDC_CLIENT_SECRET: string;
  AUTH_SECRET: string;
  API_INTERNAL_URL: string;
  WEB_ORIGIN: string;
}): void {
  if (config.NODE_ENV !== 'production') return;
  assertProductionDatabase('DATABASE_URL', config.DATABASE_URL);
  productionUrl('OIDC_ISSUER', config.OIDC_ISSUER, true);
  productionUrl('WEB_ORIGIN', config.WEB_ORIGIN, true);
  productionUrl('API_INTERNAL_URL', config.API_INTERNAL_URL, false);
  rejectDevelopmentSecret('OIDC_CLIENT_SECRET', config.OIDC_CLIENT_SECRET);
  rejectDevelopmentSecret('AUTH_SECRET', config.AUTH_SECRET);
  if (config.OIDC_CLIENT_SECRET.length < 32) {
    throw new Error(
      'Invalid production configuration: OIDC_CLIENT_SECRET must be at least 32 characters.',
    );
  }
}

function assertProductionWorker(config: {
  NODE_ENV: NodeEnvironment;
  WORKER_DATABASE_URL: string;
}): void {
  if (config.NODE_ENV === 'production') {
    assertProductionDatabase('WORKER_DATABASE_URL', config.WORKER_DATABASE_URL);
  }
}

function assertProductionStorage(config: {
  NODE_ENV: NodeEnvironment;
  S3_ENDPOINT: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
}): void {
  if (config.NODE_ENV !== 'production') return;
  const parsed = new URL(config.S3_ENDPOINT);
  const internalSeaweed = parsed.hostname === 'seaweedfs';
  if (
    (parsed.protocol !== 'https:' && !internalSeaweed) ||
    isPlaceholderHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'Invalid production configuration: S3_ENDPOINT must be a credential-free HTTPS or internal Compose URL.',
    );
  }
  rejectDevelopmentSecret('S3_ACCESS_KEY', config.S3_ACCESS_KEY);
  rejectDevelopmentSecret('S3_SECRET_KEY', config.S3_SECRET_KEY);
}

export function loadApiConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const config = parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      DATABASE_URL: postgresUrl,
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: z.string().min(1),
      WEB_ORIGIN: url,
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      API_METRICS_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .default(environment.NODE_ENV === 'production' ? 3002 : 3004),
      TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
      SCHEDULE_GENERATION_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(28),
      ROUTING_OSRM_URL: optionalHttpUrl,
      ROUTING_OSRM_PROBE_FROM: optionalRoutingProbe,
      ROUTING_OSRM_PROBE_TO: optionalRoutingProbe,
      OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    }),
    environment,
  );
  assertProductionApi(config);
  return config;
}

export function loadWebConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const config = parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      DATABASE_URL: postgresUrl,
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: z.string().min(1),
      OIDC_CLIENT_SECRET: z.string().min(1),
      AUTH_SECRET: z.string().min(32),
      API_INTERNAL_URL: url,
      WEB_ORIGIN: url,
    }),
    environment,
  );
  assertProductionWeb(config);
  return config;
}

export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const config = parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      WORKER_DATABASE_URL: postgresUrl,
      OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
      WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    }),
    environment,
  );
  assertProductionWorker(config);
  return config;
}

export function loadStorageConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const config = parse(
    z.object({
      NODE_ENV: nodeEnvironment,
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
    environment,
  );
  assertProductionStorage(config);
  return config;
}

export function loadMigrationConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const config = parse(
    z.object({
      NODE_ENV: nodeEnvironment,
      MIGRATION_DATABASE_URL: postgresUrl,
    }),
    environment,
  );
  if (config.NODE_ENV === 'production') {
    assertProductionDatabase('MIGRATION_DATABASE_URL', config.MIGRATION_DATABASE_URL);
  }
  return config;
}

export function loadProductionConfig(source: NodeJS.ProcessEnv = process.env) {
  const environment = resolveSecretFiles(source);
  const api = loadApiConfig(environment);
  const web = loadWebConfig(environment);
  const worker = loadWorkerConfig(environment);
  const storage = loadStorageConfig(environment);
  const migration = loadMigrationConfig(environment);
  const compose = parse(
    z.object({
      WEB_HOST: z.string().min(1),
      API_HOST: z.string().min(1),
      AUTHENTIK_HOST: z.string().min(1),
      API_PUBLIC_URL: url,
      AUTHENTIK_PUBLIC_URL: url,
      AUTHENTIK_WEB__BASE_URL: url,
      OIDC_REDIRECT_URI: url,
      CADDY_EMAIL: z.string().email(),
      POSTGRES_PASSWORD: z.string().min(24),
      CARE_APP_PASSWORD: z.string().min(24),
      CARE_WORKER_PASSWORD: z.string().min(24),
      AUTHENTIK_SECRET_KEY: z.string().min(50),
      AUTHENTIK_BOOTSTRAP_PASSWORD: z.string().min(16),
      GRAFANA_ADMIN_PASSWORD: z.string().min(24),
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
      SMTP_FROM: z.string().email(),
      SMTP_USERNAME: z.string().min(1),
      SMTP_PASSWORD: z.string().min(1),
      S3_INIT_ACCESS_KEY: z.string().min(16),
      S3_INIT_SECRET_KEY: z.string().min(24),
      SEAWEEDFS_S3_CONFIG_FILE: z.string().min(1),
      BACKUP_DIR: z.string().min(1),
      BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
      TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5),
    }),
    environment,
  );

  for (const name of [
    'POSTGRES_PASSWORD',
    'CARE_APP_PASSWORD',
    'CARE_WORKER_PASSWORD',
    'AUTHENTIK_SECRET_KEY',
    'AUTHENTIK_BOOTSTRAP_PASSWORD',
    'GRAFANA_ADMIN_PASSWORD',
    'SMTP_PASSWORD',
    'S3_INIT_ACCESS_KEY',
    'S3_INIT_SECRET_KEY',
  ] as const) {
    rejectDevelopmentSecret(name, compose[name]);
  }
  rejectDevelopmentSecret('SMTP_USERNAME', compose.SMTP_USERNAME);
  const smtpFromDomain = compose.SMTP_FROM.split('@').at(-1) ?? '';
  if (
    isPlaceholderHostname(compose.SMTP_HOST) ||
    compose.SMTP_HOST === 'mailpit' ||
    isPlaceholderHostname(smtpFromDomain) ||
    isPlaceholderHostname(compose.CADDY_EMAIL.split('@').at(-1) ?? '')
  ) {
    throw new Error('Invalid production configuration: replace example hosts and email domains.');
  }

  const webUrl = productionUrl('WEB_ORIGIN', web.WEB_ORIGIN, true);
  const apiUrl = productionUrl('API_PUBLIC_URL', compose.API_PUBLIC_URL, true);
  const authentikUrl = productionUrl('AUTHENTIK_PUBLIC_URL', compose.AUTHENTIK_PUBLIC_URL, true);
  if (webUrl.hostname !== compose.WEB_HOST || apiUrl.hostname !== compose.API_HOST) {
    throw new Error(
      'Invalid production configuration: public URL hosts do not match the Caddy hosts.',
    );
  }
  if (
    authentikUrl.hostname !== compose.AUTHENTIK_HOST ||
    compose.AUTHENTIK_WEB__BASE_URL !== authentikUrl.origin
  ) {
    throw new Error('Invalid production configuration: Authentik URL and Caddy host must match.');
  }
  if (!web.OIDC_ISSUER.startsWith(`${authentikUrl.origin}/application/o/`)) {
    throw new Error(
      'Invalid production configuration: OIDC_ISSUER must use the public Authentik URL.',
    );
  }
  if (compose.OIDC_REDIRECT_URI !== `${webUrl.origin}/api/auth/callback/authentik`) {
    throw new Error(
      'Invalid production configuration: OIDC_REDIRECT_URI does not match WEB_ORIGIN.',
    );
  }
  if (!isAbsolute(compose.BACKUP_DIR)) {
    throw new Error('Invalid production configuration: BACKUP_DIR must be an absolute path.');
  }

  return { api, web, worker, storage, migration, compose };
}
