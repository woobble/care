import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { EmployeesController } from '@app/api/presentation/http/employees.controller';
import {
  AUDIT_WRITER,
  EMPLOYEE_APPLICATION,
  OUTBOX_WRITER,
  SCHEDULING_GUARDS,
  VISIT_EXECUTION_GUARDS,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import { EmployeeApplicationService, type EmployeeSchedulingGuard } from '@care/employees';
import type { OutboxWriter } from '@care/platform';
import type { VisitExecutionGuards } from '@care/visit-execution';

import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';
import { VisitExecutionModule } from './visit-execution.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServiceAgreementProtectionModule,
    VisitExecutionModule,
  ],
  controllers: [EmployeesController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: EMPLOYEE_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SCHEDULING_GUARDS,
        VISIT_EXECUTION_GUARDS,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        scheduling: EmployeeSchedulingGuard,
        execution: VisitExecutionGuards,
      ) =>
        new EmployeeApplicationService(unitOfWork, audit, outbox, undefined, scheduling, execution),
    },
  ],
  exports: [EMPLOYEE_APPLICATION],
})
export class EmployeesModule {}
