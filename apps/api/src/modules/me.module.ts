import { Module } from '@nestjs/common';
import { IdentityModule } from './identity.module';
import { MeController } from '@app/api/presentation/http/me.controller';
import { OidcGuard } from '@app/api/http/auth.guards';

@Module({ imports: [IdentityModule], controllers: [MeController], providers: [OidcGuard] })
export class MeModule {}
