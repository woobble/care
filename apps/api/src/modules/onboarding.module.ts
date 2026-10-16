import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { OnboardingController } from '@app/api/presentation/http/onboarding.controller';
import {
  AUDIT_WRITER,
  ONBOARDING_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
  CLIENT_APPLICATION,
  COMMUNICATIONS_APPLICATION,
  SERVICE_APPLICATION,
  SERVICE_PRICE_APPLICATION,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService } from '@care/clients';
import type { CommunicationsApplicationService } from '@care/communications';
import type { UnitOfWork } from '@care/database';
import { createOnboardingApplicationService } from '@care/onboarding';
import type { OutboxWriter } from '@care/platform';
import type { ServiceApplicationService, ServicePriceApplicationService } from '@care/services';

import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { CommunicationsModule } from './communications.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServicesModule } from './services.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ClientsModule,
    CommunicationsModule,
    ServicesModule,
  ],
  controllers: [OnboardingController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: ONBOARDING_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        CLIENT_APPLICATION,
        COMMUNICATIONS_APPLICATION,
        SERVICE_APPLICATION,
        SERVICE_PRICE_APPLICATION,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        clients: ClientApplicationService,
        communications: CommunicationsApplicationService,
        services: ServiceApplicationService,
        prices: ServicePriceApplicationService,
      ) =>
        createOnboardingApplicationService(
          unitOfWork,
          audit,
          outbox,
          clients,
          communications,
          services,
          prices,
        ),
    },
  ],
  exports: [ONBOARDING_APPLICATION],
})
export class OnboardingModule {}
