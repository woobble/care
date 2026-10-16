import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import {
  ClientServiceAgreementsController,
  ServiceAgreementsController,
} from '@app/api/presentation/http/service-agreements.controller';
import {
  AUDIT_WRITER,
  CLIENT_APPLICATION,
  ORGANIZATION_APPLICATION,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_APPLICATION,
  SERVICE_AGREEMENT_GUARDS,
  SERVICE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import type { OrganizationApplicationService } from '@care/organizations';
import type { OutboxWriter } from '@care/platform';
import {
  createServiceAgreementApplicationService,
  type ServiceAgreementGuards,
  type ServiceAgreementApplicationService,
} from '@care/service-agreements';
import type { ServiceApplicationService } from '@care/services';

import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { IdentityModule } from './identity.module';
import { OrganizationsModule } from './organizations.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';
import { ServicesModule } from './services.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ClientsModule,
    OrganizationsModule,
    ServicesModule,
    ServiceAgreementProtectionModule,
  ],
  controllers: [ClientServiceAgreementsController, ServiceAgreementsController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: SERVICE_AGREEMENT_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        CLIENT_APPLICATION,
        ORGANIZATION_APPLICATION,
        SERVICE_APPLICATION,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SERVICE_AGREEMENT_GUARDS,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        clients: ClientApplicationService,
        organizations: OrganizationApplicationService,
        services: ServiceApplicationService,
        audit: AuditWriter,
        outbox: OutboxWriter,
        guards: ServiceAgreementGuards,
      ): ServiceAgreementApplicationService =>
        createServiceAgreementApplicationService(
          unitOfWork,
          clients,
          organizations,
          services,
          audit,
          outbox,
          guards,
        ),
    },
  ],
  exports: [SERVICE_AGREEMENT_APPLICATION],
})
export class ServiceAgreementsModule {}
