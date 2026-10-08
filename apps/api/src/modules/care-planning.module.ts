import { Module } from '@nestjs/common';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { VisitExecutionApplicationService } from '@care/visit-execution';
import { CarePlanningApplicationService } from '@care/care-planning';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  CARE_PLANNING_APPLICATION,
  CLIENT_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
  VISIT_EXECUTION_APPLICATION,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { CarePlanningController } from '../presentation/http/care-planning.controller';
import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { VisitExecutionModule } from './visit-execution.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ClientsModule,
    VisitExecutionModule,
  ],
  controllers: [CarePlanningController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: CARE_PLANNING_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        CLIENT_APPLICATION,
        VISIT_EXECUTION_APPLICATION,
        AUDIT_WRITER,
        OUTBOX_WRITER,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        clients: ClientApplicationService,
        visits: VisitExecutionApplicationService,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ) => new CarePlanningApplicationService(unitOfWork, clients, visits, audit, outbox),
    },
  ],
  exports: [CARE_PLANNING_APPLICATION],
})
export class CarePlanningModule {}
