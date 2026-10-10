import { Module } from '@nestjs/common';
import {
  CareDocumentationApplicationService,
  createCareDocumentationApplicationService,
} from '@care/care-documentation';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import {
  AUDIT_WRITER,
  CARE_DOCUMENTATION_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import { CareDocumentationController } from '@app/api/presentation/http/care-documentation.controller';
import { AuditModule } from './audit.module';
import { PlatformModule } from './platform.module';
import { IdentityModule } from './identity.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [CareDocumentationController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: CARE_DOCUMENTATION_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): CareDocumentationApplicationService =>
        createCareDocumentationApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [CARE_DOCUMENTATION_APPLICATION],
})
export class CareDocumentationModule {}
