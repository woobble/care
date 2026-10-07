import { Module } from '@nestjs/common';
import { createServiceApplicationService } from '@care/services';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { ServiceAgreementGuards } from '@care/service-agreements';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_GUARDS,
  SERVICE_APPLICATION,
  UNIT_OF_WORK,
} from '../tokens';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import {
  ServiceCategoriesController,
  ServicesController,
} from '../presentation/http/services.controller';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServiceAgreementProtectionModule,
  ],
  controllers: [ServiceCategoriesController, ServicesController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: SERVICE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER, SERVICE_AGREEMENT_GUARDS],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        guards: ServiceAgreementGuards,
      ) => createServiceApplicationService(unitOfWork, audit, outbox, guards),
    },
  ],
  exports: [SERVICE_APPLICATION],
})
export class ServicesModule {}
