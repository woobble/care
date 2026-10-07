import { Module } from '@nestjs/common';
import { EmployeeApplicationService, type EmployeeSchedulingGuard } from '@care/employees';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import { EmployeesController } from '../presentation/http/employees.controller';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import {
  AUDIT_WRITER,
  EMPLOYEE_APPLICATION,
  OUTBOX_WRITER,
  SCHEDULING_GUARDS,
  UNIT_OF_WORK,
} from '../tokens';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServiceAgreementProtectionModule,
  ],
  controllers: [EmployeesController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: EMPLOYEE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER, SCHEDULING_GUARDS],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        scheduling: EmployeeSchedulingGuard,
      ) => new EmployeeApplicationService(unitOfWork, audit, outbox, undefined, scheduling),
    },
  ],
  exports: [EMPLOYEE_APPLICATION],
})
export class EmployeesModule {}
