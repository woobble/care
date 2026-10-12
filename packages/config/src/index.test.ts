import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadProductionConfig } from './index';

const temporaryDirectories: string[] = [];

function productionEnvironment(): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), 'care-production-config-'));
  temporaryDirectories.push(directory);
  const secret = (name: string, value: string) => {
    const path = join(directory, name);
    writeFileSync(path, `${value}\n`, { mode: 0o600 });
    return path;
  };

  const s3AccessKey = 'production-access-key-123456789';
  const s3SecretKey = 'production-s3-secret-123456789012345678901';
  const s3InitAccessKey = 'seaweed-init-access-key-123456789';
  const s3InitSecretKey = 'seaweed-init-secret-key-123456789012345678901';

  return {
    NODE_ENV: 'production',
    DATABASE_URL_FILE: secret(
      'database-url',
      'postgresql://care_app:app-secret-123456789012345678901234@postgres:5432/care',
    ),
    MIGRATION_DATABASE_URL_FILE: secret(
      'migration-url',
      'postgresql://care_owner:migration-secret-123456789012345678901234@postgres:5432/care',
    ),
    WORKER_DATABASE_URL_FILE: secret(
      'worker-url',
      'postgresql://care_worker:worker-secret-123456789012345678901234@postgres:5432/care',
    ),
    OIDC_ISSUER: 'https://login.care-pilot.org/application/o/care-platform/',
    OIDC_CLIENT_ID: 'care-platform',
    OIDC_CLIENT_SECRET: 'oidc-client-secret-123456789012345678901234',
    AUTH_SECRET_FILE: secret('auth-secret', 'auth-secret-12345678901234567890123456789012'),
    WEB_ORIGIN: 'https://care-pilot.org',
    API_INTERNAL_URL: 'http://api:3001',
    API_PUBLIC_URL: 'https://api.care-pilot.org',
    AUTHENTIK_PUBLIC_URL: 'https://login.care-pilot.org',
    AUTHENTIK_WEB__BASE_URL: 'https://login.care-pilot.org',
    OIDC_REDIRECT_URI: 'https://care-pilot.org/api/auth/callback/authentik',
    WEB_HOST: 'care-pilot.org',
    API_HOST: 'api.care-pilot.org',
    AUTHENTIK_HOST: 'login.care-pilot.org',
    CADDY_EMAIL: 'operator@care-pilot.org',
    TRUSTED_PROXY_HOPS: '1',
    DATABASE_URL: undefined,
    S3_ENDPOINT: 'http://seaweedfs:8333',
    S3_REGION: 'eu-central-1',
    S3_BUCKET: 'care-documents',
    S3_ACCESS_KEY_FILE: secret('s3-access-key', s3AccessKey),
    S3_SECRET_KEY_FILE: secret('s3-secret-key', s3SecretKey),
    S3_INIT_ACCESS_KEY_FILE: secret('s3-init-access-key', s3InitAccessKey),
    S3_INIT_SECRET_KEY_FILE: secret('s3-init-secret-key', s3InitSecretKey),
    SEAWEEDFS_S3_CONFIG_FILE: secret(
      'seaweedfs-s3.json',
      JSON.stringify({
        identities: [
          {
            credentials: [{ accessKey: s3AccessKey, secretKey: s3SecretKey }],
            actions: ['Read', 'List', 'Tagging', 'Write'],
          },
          {
            credentials: [{ accessKey: s3InitAccessKey, secretKey: s3InitSecretKey }],
            actions: ['Admin', 'List'],
          },
        ],
      }),
    ),
    POSTGRES_PASSWORD: 'postgres-owner-password-123456789012',
    CARE_APP_PASSWORD: 'application-password-12345678901234',
    CARE_WORKER_PASSWORD: 'worker-password-123456789012345678',
    AUTHENTIK_SECRET_KEY: 'authentik-signing-secret-123456789012345678901234567890',
    AUTHENTIK_BOOTSTRAP_PASSWORD: 'authentik-bootstrap-password-123456',
    GRAFANA_ADMIN_PASSWORD: 'grafana-admin-password-12345678901234567890',
    SMTP_HOST: 'smtp.care-pilot.org',
    SMTP_PORT: '587',
    SMTP_FROM: 'care@care-pilot.org',
    SMTP_USERNAME: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password-123456789012',
    BACKUP_DIR: '/var/backups/care-platform',
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production configuration', () => {
  test('loads complete HTTPS configuration and Compose secret files', () => {
    const config = loadProductionConfig(productionEnvironment());
    expect(config.api.TRUSTED_PROXY_HOPS).toBe(1);
    expect(config.compose.BACKUP_RETENTION_DAYS).toBe(30);
    expect(config.storage.S3_SECRET_KEY).toBe('production-s3-secret-123456789012345678901');
  });

  test('rejects development database credentials without exposing secret contents', () => {
    const environment = productionEnvironment();
    const path = environment.DATABASE_URL_FILE!;
    writeFileSync(path, 'postgresql://care_app:dev-only-sensitive-value@postgres:5432/care', {
      mode: 0o600,
    });

    let message = '';
    try {
      loadProductionConfig(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('dev-only-sensitive-value');
  });

  test('rejects public HTTP URLs and a missing trusted proxy setting', () => {
    const insecureOrigin = productionEnvironment();
    insecureOrigin.WEB_ORIGIN = 'http://care-pilot.org';
    insecureOrigin.OIDC_REDIRECT_URI = 'http://care-pilot.org/api/auth/callback/authentik';
    expect(() => loadProductionConfig(insecureOrigin)).toThrow(/WEB_ORIGIN/);

    const untrustedProxy = productionEnvironment();
    untrustedProxy.TRUSTED_PROXY_HOPS = '0';
    expect(() => loadProductionConfig(untrustedProxy)).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  test('requires HTTPS for external routing and permits the private Compose OSRM service', () => {
    const externalHttp = productionEnvironment();
    externalHttp.ROUTING_OSRM_URL = 'http://routing.care-pilot.org';
    expect(() => loadProductionConfig(externalHttp)).toThrow(/ROUTING_OSRM_URL.*HTTPS/);

    const internalOsrm = productionEnvironment();
    internalOsrm.ROUTING_OSRM_URL = 'http://osrm:5000';
    expect(loadProductionConfig(internalOsrm).api.ROUTING_OSRM_URL).toBe('http://osrm:5000');
  });

  test('requires valid production mail delivery configuration', () => {
    const missingPassword = productionEnvironment();
    delete missingPassword.SMTP_PASSWORD;
    expect(() => loadProductionConfig(missingPassword)).toThrow(/SMTP_PASSWORD/);

    const invalidPort = productionEnvironment();
    invalidPort.SMTP_PORT = '70000';
    expect(() => loadProductionConfig(invalidPort)).toThrow(/SMTP_PORT/);
  });

  test('rejects credentials embedded in production service URLs without echoing them', () => {
    const environment = productionEnvironment();
    environment.S3_ENDPOINT = 'https://private-access:private-secret@storage.care-pilot.org';
    let message = '';
    try {
      loadProductionConfig(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('S3_ENDPOINT');
    expect(message).not.toContain('private-access');
    expect(message).not.toContain('private-secret');
  });

  test('rejects copied example secrets and email hosts', () => {
    const placeholderSecret = productionEnvironment();
    placeholderSecret.OIDC_CLIENT_SECRET = 'REPLACE_WITH_AUTHENTIK_CLIENT_SECRET';
    expect(() => loadProductionConfig(placeholderSecret)).toThrow(/OIDC_CLIENT_SECRET/);

    const placeholderGrafanaPassword = productionEnvironment();
    placeholderGrafanaPassword.GRAFANA_ADMIN_PASSWORD = 'REPLACE_WITH_RANDOM_SECRET';
    expect(() => loadProductionConfig(placeholderGrafanaPassword)).toThrow(
      /GRAFANA_ADMIN_PASSWORD/,
    );

    const placeholderHost = productionEnvironment();
    placeholderHost.SMTP_HOST = 'smtp.example.org';
    expect(() => loadProductionConfig(placeholderHost)).toThrow(/example hosts/);
  });
});
