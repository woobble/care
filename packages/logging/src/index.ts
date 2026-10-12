import pino, { type Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'authorization',
        'access_token',
        'refresh_token',
        'id_token',
        'accessToken',
        'refreshToken',
        'idToken',
        'clientSecret',
        'client_secret',
        'secretKey',
        'secret_key',
        'DATABASE_URL',
        'MIGRATION_DATABASE_URL',
        'WORKER_DATABASE_URL',
        'databaseUrl',
        'connectionString',
        'AUTH_SECRET',
        'OIDC_CLIENT_SECRET',
        'S3_SECRET_KEY',
        'S3_ACCESS_KEY',
        'AUTHENTIK_SECRET_KEY',
        'AUTHENTIK_BOOTSTRAP_PASSWORD',
        'POSTGRES_PASSWORD',
        'CARE_APP_PASSWORD',
        'CARE_WORKER_PASSWORD',
        'SMTP_PASSWORD',
        'SMTP_USERNAME',
        'password',
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-api-key',
        'res.headers.set-cookie',
      ],
      censor: '[redacted]',
    },
  });
}

export function correlationIdFromRequest(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-care-correlation-id'];
  return typeof value === 'string' ? value : uuidv7();
}
