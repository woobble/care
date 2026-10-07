import { Module } from '@nestjs/common';
import { OrganizationApplicationService } from '@care/organizations';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { ServiceAgreementGuards } from '@care/service-agreements';
import type { OrganizationSchedulingGuard } from '@care/organizations';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from './identity.module';
import { OrganizationsController } from '../presentation/http/organizations.controller';
import {
  AUDIT_WRITER,
  ORGANIZATION_APPLICATION,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_GUARDS,
  SCHEDULING_GUARDS,
  UNIT_OF_WORK,
} from '../tokens';
import { AuditModule } from './audit.module';
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
  controllers: [OrganizationsController],
  providers: [
    {
      provide: ORGANIZATION_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SERVICE_AGREEMENT_GUARDS,
        SCHEDULING_GUARDS,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        guards: ServiceAgreementGuards,
        scheduling: OrganizationSchedulingGuard,
      ) =>
        new OrganizationApplicationService(
          unitOfWork,
          audit,
          outbox,
          undefined,
          guards,
          scheduling,
        ),
    },
  ],
  exports: [ORGANIZATION_APPLICATION],
})
export class OrganizationsModule {}
