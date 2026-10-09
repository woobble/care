import { Module } from '@nestjs/common';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import { WorkforceComplianceApplicationService } from '@care/workforce-compliance';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
  WORKFORCE_COMPLIANCE_APPLICATION,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { WorkforceComplianceController } from '../presentation/http/workforce-compliance.controller';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [WorkforceComplianceController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: WORKFORCE_COMPLIANCE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new WorkforceComplianceApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [WORKFORCE_COMPLIANCE_APPLICATION],
})
export class WorkforceComplianceModule {}
