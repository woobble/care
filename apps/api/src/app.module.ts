import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit.module';
import { AuditQueryModule } from './modules/audit-query.module';
import { ClientsModule } from './modules/clients.module';
import { EmployeesModule } from './modules/employees.module';
import { IdentityModule } from './modules/identity.module';
import { MeModule } from './modules/me.module';
import { OrganizationsModule } from './modules/organizations.module';
import { PlatformModule } from './modules/platform.module';
import { ServicesModule } from './modules/services.module';
import { ServiceAgreementsModule } from './modules/service-agreements.module';
import { SchedulingModule } from './modules/scheduling.module';
import { HealthController } from './presentation/http/health.controller';
import { ProblemDetailsFilter } from './presentation/http/problem-details.filter';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    OrganizationsModule,
    EmployeesModule,
    AuditModule,
    AuditQueryModule,
    PlatformModule,
    ClientsModule,
    ServicesModule,
    ServiceAgreementsModule,
    SchedulingModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
