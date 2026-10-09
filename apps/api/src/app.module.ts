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
import { VisitExecutionModule } from './modules/visit-execution.module';
import { CareDocumentationModule } from './modules/care-documentation.module';
import { CarePlanningModule } from './modules/care-planning.module';
import { ServiceEvidenceModule } from './modules/service-evidence.module';
import { CompetencyPoliciesModule } from './modules/competency-policies.module';
import { WorkforceComplianceModule } from './modules/workforce-compliance.module';
import { MedicationModule } from './modules/medication.module';
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
    VisitExecutionModule,
    CareDocumentationModule,
    CarePlanningModule,
    ServiceEvidenceModule,
    CompetencyPoliciesModule,
    WorkforceComplianceModule,
    MedicationModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
