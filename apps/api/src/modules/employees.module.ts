import { Module } from '@nestjs/common';
import { EmployeeApplicationService } from '@care/employees';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import { EmployeesController } from '../presentation/http/employees.controller';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { AUDIT_WRITER, EMPLOYEE_APPLICATION, OUTBOX_WRITER, UNIT_OF_WORK } from '../tokens';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [EmployeesController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: EMPLOYEE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new EmployeeApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [EMPLOYEE_APPLICATION],
})
export class EmployeesModule {}
