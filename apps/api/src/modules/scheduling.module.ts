import { Module } from '@nestjs/common';
import { loadApiConfig } from '@care/config';
import {
  createSchedulingApplicationService,
  type SchedulingApplicationService,
} from '@care/scheduling';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import type { EmployeeApplicationService } from '@care/employees';
import type { OrganizationApplicationService } from '@care/organizations';
import type { OutboxWriter } from '@care/platform';
import type { ServiceAgreementApplicationService } from '@care/service-agreements';
import type { ServiceApplicationService } from '@care/services';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  CLIENT_APPLICATION,
  EMPLOYEE_APPLICATION,
  ORGANIZATION_APPLICATION,
  OUTBOX_WRITER,
  SCHEDULING_APPLICATION,
  SERVICE_AGREEMENT_APPLICATION,
  SERVICE_APPLICATION,
  UNIT_OF_WORK,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import {
  AgreementVisitGenerationController,
  EmployeeUnavailabilityController,
  VisitsController,
} from '../presentation/http/scheduling.controller';
import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { EmployeesModule } from './employees.module';
import { IdentityModule } from './identity.module';
import { OrganizationsModule } from './organizations.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementsModule } from './service-agreements.module';
import { ServicesModule } from './services.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ClientsModule,
    EmployeesModule,
    OrganizationsModule,
    ServicesModule,
    ServiceAgreementsModule,
  ],
  controllers: [
    VisitsController,
    AgreementVisitGenerationController,
    EmployeeUnavailabilityController,
  ],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: SCHEDULING_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        CLIENT_APPLICATION,
        ORGANIZATION_APPLICATION,
        EMPLOYEE_APPLICATION,
        SERVICE_APPLICATION,
        SERVICE_AGREEMENT_APPLICATION,
        AUDIT_WRITER,
        OUTBOX_WRITER,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        clients: ClientApplicationService,
        organizations: OrganizationApplicationService,
        employees: EmployeeApplicationService,
        services: ServiceApplicationService,
        agreements: ServiceAgreementApplicationService,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): SchedulingApplicationService =>
        createSchedulingApplicationService(
          unitOfWork,
          clients,
          organizations,
          employees,
          services,
          agreements,
          audit,
          outbox,
          loadApiConfig().SCHEDULE_GENERATION_HORIZON_DAYS,
        ),
    },
  ],
})
export class SchedulingModule {}
