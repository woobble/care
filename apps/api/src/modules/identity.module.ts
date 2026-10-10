import { Module } from '@nestjs/common';
import { IdentityService, TenantAccessService } from '@care/identity';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { AuditModule } from './audit.module';
import { PlatformModule } from './platform.module';
import { TenantAccessController } from '@app/api/presentation/http/tenant-access.controller';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import {
  AUDIT_WRITER,
  DATABASE,
  IDENTITY_SERVICE,
  OUTBOX_WRITER,
  TENANT_ACCESS_SERVICE,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import { DatabaseModule } from '@app/api/database/database.module';
import type { AppDatabase } from '@app/api/database/database.module';

@Module({
  imports: [DatabaseModule, AuditModule, PlatformModule],
  controllers: [TenantAccessController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: IDENTITY_SERVICE,
      inject: [DATABASE],
      useFactory: (database: AppDatabase) => new IdentityService(database.db),
    },
    {
      provide: TENANT_ACCESS_SERVICE,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new TenantAccessService(unitOfWork, audit, outbox),
    },
  ],
  exports: [IDENTITY_SERVICE, TENANT_ACCESS_SERVICE, OidcGuard, TenantContextGuard],
})
export class IdentityModule {}
