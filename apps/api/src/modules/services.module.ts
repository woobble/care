import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { ServicePricesController } from '@app/api/presentation/http/service-prices.controller';
import {
  ServiceCategoriesController,
  ServicesController,
} from '@app/api/presentation/http/services.controller';
import {
  AUDIT_WRITER,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_GUARDS,
  SERVICE_APPLICATION,
  SERVICE_PRICE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { ServiceAgreementGuards } from '@care/service-agreements';
import { createServiceApplicationService, ServicePriceApplicationService } from '@care/services';

import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServiceAgreementProtectionModule,
  ],
  controllers: [ServiceCategoriesController, ServicesController, ServicePricesController],
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
    {
      provide: SERVICE_PRICE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new ServicePriceApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [SERVICE_APPLICATION, SERVICE_PRICE_APPLICATION],
})
export class ServicesModule {}
