import { Module } from '@nestjs/common';
import { createClientApplicationService } from '@care/clients';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import { AUDIT_WRITER, CLIENT_APPLICATION, OUTBOX_WRITER, UNIT_OF_WORK } from '../tokens';
import { AuditModule } from './audit.module';
import { PlatformModule } from './platform.module';
import { IdentityModule } from './identity.module';
import { ClientsController } from '../presentation/http/clients.controller';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [ClientsController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: CLIENT_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        createClientApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [CLIENT_APPLICATION],
})
export class ClientsModule {}
