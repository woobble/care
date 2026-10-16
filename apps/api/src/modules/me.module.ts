import { Module } from '@nestjs/common';

import { OidcGuard } from '@app/api/http/auth.guards';
import { MeController } from '@app/api/presentation/http/me.controller';

import { IdentityModule } from './identity.module';

@Module({ imports: [IdentityModule], controllers: [MeController], providers: [OidcGuard] })
export class MeModule {}
