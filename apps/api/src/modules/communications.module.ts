import { Module } from '@nestjs/common';
import { createCommunicationsApplicationService } from '@care/communications';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import { AUDIT_WRITER, COMMUNICATIONS_APPLICATION, OUTBOX_WRITER, UNIT_OF_WORK } from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { CommunicationsController } from '../presentation/http/communications.controller';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [CommunicationsController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: COMMUNICATIONS_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        createCommunicationsApplicationService(unitOfWork, audit, outbox),
    },
  ],
})
export class CommunicationsModule {}
