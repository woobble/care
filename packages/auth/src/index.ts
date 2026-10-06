import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface OidcVerifierConfig {
  issuer: string;
  audience: string;
}

export interface ExternalIdentity {
  issuer: string;
  subject: string;
}

export interface VerifiedIdentity extends ExternalIdentity {
  claims: JWTPayload;
}

export async function createAccessTokenVerifier(config: OidcVerifierConfig) {
  const metadataUrl = new URL('.well-known/openid-configuration', config.issuer);
  const response = await fetch(metadataUrl);
  if (!response.ok) throw new Error('OIDC discovery failed');

  const metadata: unknown = await response.json();
  if (!isDiscoveryDocument(metadata) || metadata.issuer !== config.issuer) {
    throw new Error('OIDC issuer metadata is invalid');
  }

  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));

  return async (token: string): Promise<VerifiedIdentity> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['RS256', 'RS384', 'ES256', 'ES384'],
    });
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new Error('OIDC token expiry is missing');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('OIDC subject is missing');
    }
    if (typeof payload.iss !== 'string') throw new Error('OIDC issuer is missing');
    return { issuer: payload.iss, subject: payload.sub, claims: payload };
  };
}

function isDiscoveryDocument(value: unknown): value is { issuer: string; jwks_uri: string } {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'issuer' in value &&
    typeof value.issuer === 'string' &&
    'jwks_uri' in value &&
    typeof value.jwks_uri === 'string'
  );
}
