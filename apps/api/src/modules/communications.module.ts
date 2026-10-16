import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { CommunicationsController } from '@app/api/presentation/http/communications.controller';
import {
  AUDIT_WRITER,
  COMMUNICATIONS_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import { createCommunicationsApplicationService } from '@care/communications';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';

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
  exports: [COMMUNICATIONS_APPLICATION],
})
export class CommunicationsModule {}
