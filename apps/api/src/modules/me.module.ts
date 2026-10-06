import { Module } from '@nestjs/common';
import { IdentityModule } from './identity.module';
import { MeController } from '../presentation/http/me.controller';
import { OidcGuard } from '../http/auth.guards';

@Module({ imports: [IdentityModule], controllers: [MeController], providers: [OidcGuard] })
export class MeModule {}
