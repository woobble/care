// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before creating the auth provider
import '@care/config/load-env';
import { loadWebConfig } from '@care/config';
import { createDatabase } from '@care/database';
import { betterAuthSchema } from '@care/identity';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

const buildSecret = 'build-only-secret-value-that-is-never-used-at-runtime';
const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
const config = loadWebConfig(
  isBuild
    ? {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgres://care_app:build-only@127.0.0.1:5432/care',
        OIDC_ISSUER:
          process.env.OIDC_ISSUER ?? 'http://localhost:9000/application/o/care-platform/',
        OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID ?? 'care-platform-build',
        OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? 'build-only-secret',
        AUTH_SECRET: process.env.AUTH_SECRET ?? buildSecret,
        API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? 'http://localhost:3001',
        WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
      }
    : process.env,
);

const database = createDatabase(config.DATABASE_URL, betterAuthSchema);
const discoveryUrl = new URL('.well-known/openid-configuration', config.OIDC_ISSUER).toString();
const authentikConfig = isBuild
  ? {
      providerId: 'authentik',
      name: 'Authentik',
      authorizationUrl: new URL('authorize/', config.OIDC_ISSUER).toString(),
      tokenUrl: new URL('token/', config.OIDC_ISSUER).toString(),
      userInfoUrl: new URL('userinfo/', config.OIDC_ISSUER).toString(),
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      accessType: 'offline',
      disableProviderLogout: true,
    }
  : {
      providerId: 'authentik',
      name: 'Authentik',
      discoveryUrl,
      requireIdTokenVerification: true,
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      accessType: 'offline',
      disableProviderLogout: true,
    };

export const auth = betterAuth({
  appName: 'Care Platform',
  baseURL: config.WEB_ORIGIN,
  basePath: '/api/auth',
  secret: config.AUTH_SECRET,
  trustedOrigins: [config.WEB_ORIGIN],
  database: drizzleAdapter(database.db, { provider: 'pg', schema: betterAuthSchema }),
  emailAndPassword: { enabled: false },
  session: { expiresIn: 8 * 60 * 60, updateAge: 60 * 60 },
  account: {
    encryptOAuthTokens: true,
    accountLinking: { enabled: false },
  },
  advanced: { useSecureCookies: config.NODE_ENV === 'production' },
  plugins: [
    genericOAuth({
      config: [authentikConfig],
    }),
    nextCookies(),
  ],
});
