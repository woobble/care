import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DatabaseModule } from './database/database.module';
import { AuditQueryModule } from './modules/audit-query.module';
import { AuditModule } from './modules/audit.module';
import { BenefitsModule } from './modules/benefits.module';
import { BillingModule } from './modules/billing.module';
import { CareDocumentationModule } from './modules/care-documentation.module';
import { ClientsModule } from './modules/clients.module';
import { CommunicationsModule } from './modules/communications.module';
import { DocumentWorkflowsModule } from './modules/document-workflows.module';
import { DocumentsModule } from './modules/documents.module';
import { EmployeesModule } from './modules/employees.module';
import { IdentityModule } from './modules/identity.module';
import { MeModule } from './modules/me.module';
import { OnboardingModule } from './modules/onboarding.module';
import { OperationsModule } from './modules/operations.module';
import { OrganizationsModule } from './modules/organizations.module';
import { PlatformModule } from './modules/platform.module';
import { SchedulingModule } from './modules/scheduling.module';
import { ServiceAgreementsModule } from './modules/service-agreements.module';
import { ServiceEvidenceModule } from './modules/service-evidence.module';
import { ServicesModule } from './modules/services.module';
import { VisitExecutionModule } from './modules/visit-execution.module';
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
    CommunicationsModule,
    ServicesModule,
    ServiceAgreementsModule,
    SchedulingModule,
    VisitExecutionModule,
    CareDocumentationModule,
    ServiceEvidenceModule,
    BenefitsModule,
    BillingModule,
    DocumentsModule,
    DocumentWorkflowsModule,
    OperationsModule,
    OnboardingModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
