import { Module } from '@nestjs/common';
import {
  createVisitExecutionApplicationService,
  createVisitExecutionGuards,
  type VisitExecutionApplicationService,
  type VisitExecutionGuards,
} from '@care/visit-execution';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '@app/api/database/database.module';
import {
  AUDIT_WRITER,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
  VISIT_EXECUTION_APPLICATION,
  VISIT_EXECUTION_GUARDS,
} from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import {
  MyVisitsController,
  VisitExecutionController,
  VisitExecutionCorrectionsController,
  VisitExecutionSummariesController,
} from '@app/api/presentation/http/visit-execution.controller';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [
    MyVisitsController,
    VisitExecutionController,
    VisitExecutionCorrectionsController,
    VisitExecutionSummariesController,
  ],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: VISIT_EXECUTION_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): VisitExecutionApplicationService =>
        createVisitExecutionApplicationService(unitOfWork, audit, outbox),
    },
    {
      provide: VISIT_EXECUTION_GUARDS,
      useFactory: (): VisitExecutionGuards => createVisitExecutionGuards(),
    },
  ],
  exports: [VISIT_EXECUTION_APPLICATION, VISIT_EXECUTION_GUARDS],
})
export class VisitExecutionModule {}
