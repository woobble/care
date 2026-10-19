import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import {
  AgreementVisitGenerationController,
  EmployeeAvailabilityController,
  SchedulingOperationsController,
  SchedulingToursController,
  MyTodayTourController,
  MyPublishedToursController,
  SubstitutionsController,
  EmployeeSchedulingPreferencesController,
  ClientSchedulingPreferencesController,
  ClientRoutingLocationController,
  EmployeeUnavailabilityController,
  VisitsController,
} from '@app/api/presentation/http/scheduling.controller';
import {
  CalendarSubscriptionFeedController,
  CalendarSubscriptionRateLimiter,
  MyCalendarSubscriptionController,
} from '@app/api/presentation/http/calendar-subscriptions.controller';
import {
  AUDIT_WRITER,
  CALENDAR_SUBSCRIPTION_APPLICATION,
  CLIENT_APPLICATION,
  EMPLOYEE_APPLICATION,
  ORGANIZATION_APPLICATION,
  OUTBOX_WRITER,
  SCHEDULING_APPLICATION,
  VISIT_EXECUTION_GUARDS,
  SERVICE_AGREEMENT_APPLICATION,
  SERVICE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { ClientApplicationService } from '@care/clients';
import { loadApiConfig } from '@care/config';
import type { UnitOfWork } from '@care/database';
import type { EmployeeApplicationService } from '@care/employees';
import type { OrganizationApplicationService } from '@care/organizations';
import type { OutboxWriter } from '@care/platform';
import {
  CalendarSubscriptionApplicationService,
  createSchedulingApplicationService,
  type SchedulingApplicationService,
} from '@care/scheduling';
import { OsrmRouteProvider, UnavailableRouteProvider } from '@care/scheduling';
import type { ServiceAgreementApplicationService } from '@care/service-agreements';
import type { ServiceApplicationService } from '@care/services';
import type { VisitExecutionGuards } from '@care/visit-execution';

import { AuditModule } from './audit.module';
import { ClientsModule } from './clients.module';
import { EmployeesModule } from './employees.module';
import { IdentityModule } from './identity.module';
import { OrganizationsModule } from './organizations.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementsModule } from './service-agreements.module';
import { ServicesModule } from './services.module';
import { VisitExecutionModule } from './visit-execution.module';

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
    VisitExecutionModule,
  ],
  controllers: [
    VisitsController,
    MyCalendarSubscriptionController,
    CalendarSubscriptionFeedController,
    AgreementVisitGenerationController,
    EmployeeUnavailabilityController,
    EmployeeAvailabilityController,
    SchedulingOperationsController,
    SchedulingToursController,
    MyTodayTourController,
    MyPublishedToursController,
    SubstitutionsController,
    EmployeeSchedulingPreferencesController,
    ClientSchedulingPreferencesController,
    ClientRoutingLocationController,
  ],
  providers: [
    OidcGuard,
    TenantContextGuard,
    CalendarSubscriptionRateLimiter,
    {
      provide: CALENDAR_SUBSCRIPTION_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): CalendarSubscriptionApplicationService =>
        new CalendarSubscriptionApplicationService(unitOfWork, audit, outbox),
    },
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
        VISIT_EXECUTION_GUARDS,
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
        executionGuards: VisitExecutionGuards,
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
          executionGuards,
          loadApiConfig().ROUTING_OSRM_URL
            ? new OsrmRouteProvider(loadApiConfig().ROUTING_OSRM_URL!)
            : new UnavailableRouteProvider(),
        ),
    },
  ],
  exports: [SCHEDULING_APPLICATION],
})
export class SchedulingModule {}
