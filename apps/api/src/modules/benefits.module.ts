import { Module } from '@nestjs/common';
import { createBenefitsApplicationService } from '@care/benefits';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '@app/api/database/database.module';
import { AUDIT_WRITER, BENEFITS_APPLICATION, OUTBOX_WRITER, UNIT_OF_WORK } from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { BenefitsController } from '@app/api/presentation/http/benefits.controller';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [BenefitsController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: BENEFITS_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        createBenefitsApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [BENEFITS_APPLICATION],
})
export class BenefitsModule {}
