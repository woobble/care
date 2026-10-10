import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createAccessTokenVerifier, type VerifiedIdentity } from '@care/auth';
import { loadApiConfig } from '@care/config';
import { DisabledUserError, IdentityService, TenantAccessService } from '@care/identity';
import { asUUID } from '@care/contracts';
import { IDENTITY_SERVICE, TENANT_ACCESS_SERVICE } from '@app/api/tokens';
import type { ApiRequest } from './request';
import { requestContext } from './request';

@Injectable()
export class OidcGuard implements CanActivate {
  private verifierPromise?: ReturnType<typeof createAccessTokenVerifier>;

  constructor(
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(TENANT_ACCESS_SERVICE) private readonly tenantAccess: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/.exec(header) : null;
    if (!match?.[1]) throw new UnauthorizedException();

    let verified: VerifiedIdentity;
    try {
      this.verifierPromise ??= this.createVerifier();
      const verify = await this.verifierPromise;
      verified = await verify(match[1]);
    } catch {
      throw new UnauthorizedException();
    }

    try {
      const user = await this.identity.resolveOrProvision(verified);
      if (user.status !== 'active') throw new ForbiddenException();
      const email =
        verified.claims.email_verified === true && typeof verified.claims.email === 'string'
          ? verified.claims.email
          : undefined;
      const userAgent = request.headers['user-agent'];
      await this.tenantAccess.acceptMatchingInvitation(user.id, email, requestContext(request), {
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
      });
      request.identity = { userId: user.id, issuer: verified.issuer, subject: verified.subject };
      return true;
    } catch (error) {
      if (error instanceof DisabledUserError) throw new ForbiddenException();
      throw error;
    }
  }

  private async createVerifier() {
    const config = loadApiConfig();
    return createAccessTokenVerifier({
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_CLIENT_ID,
    });
  }
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (!request.identity) throw new UnauthorizedException();
    const header = request.headers['x-tenant-id'];
    if (typeof header !== 'string') throw new BadRequestException();
    let tenantId: string;
    try {
      tenantId = asUUID(header);
    } catch {
      throw new BadRequestException();
    }
    try {
      request.principal = await this.identity.loadTenantPrincipal(
        request.identity.userId,
        tenantId,
      );
      return true;
    } catch {
      throw new ForbiddenException();
    }
  }
}
