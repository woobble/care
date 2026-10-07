import { Module } from '@nestjs/common';
import {
  createServiceAgreementApplicationService,
  type ServiceAgreementApplicationService,
} from '@care/service-agreements';
import type { ClientApplicationService } from '@care/clients';
import type { OrganizationApplicationService } from '@care/organizations';
import type { ServiceApplicationService } from '@care/services';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  CLIENT_APPLICATION,
  ORGANIZATION_APPLICATION,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_APPLICATION,
  SERVICE_APPLICATION,
  UNIT_OF_WORK,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { IdentityModule } from './identity.module';
import { OrganizationsModule } from './organizations.module';
import { PlatformModule } from './platform.module';
import { ServicesModule } from './services.module';
import {
  ClientServiceAgreementsController,
  ServiceAgreementsController,
} from '../presentation/http/service-agreements.controller';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ClientsModule,
    OrganizationsModule,
    ServicesModule,
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
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        clients: ClientApplicationService,
        organizations: OrganizationApplicationService,
        services: ServiceApplicationService,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): ServiceAgreementApplicationService =>
        createServiceAgreementApplicationService(
          unitOfWork,
          clients,
          organizations,
          services,
          audit,
          outbox,
        ),
    },
  ],
})
export class ServiceAgreementsModule {}
