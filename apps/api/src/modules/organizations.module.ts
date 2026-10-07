import { Module } from '@nestjs/common';
import { OrganizationApplicationService } from '@care/organizations';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from './identity.module';
import { OrganizationsController } from '../presentation/http/organizations.controller';
import { AUDIT_WRITER, ORGANIZATION_APPLICATION, OUTBOX_WRITER, UNIT_OF_WORK } from '../tokens';
import { AuditModule } from './audit.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [OrganizationsController],
  providers: [
    {
      provide: ORGANIZATION_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new OrganizationApplicationService(unitOfWork, audit, outbox),
    },
  ],
})
export class OrganizationsModule {}
