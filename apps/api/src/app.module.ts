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
    MeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
