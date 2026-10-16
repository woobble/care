import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { OperationsController } from '@app/api/presentation/http/operations.controller';
import {
  AUDIT_WRITER,
  BENEFITS_APPLICATION,
  BILLING_APPLICATION,
  BILLING_CLAIMS_APPLICATION,
  CARE_DOCUMENTATION_APPLICATION,
  OPERATIONS_APPLICATION,
  OPERATIONS_RECURRENCE_APPLICATION,
  OUTBOX_WRITER,
  ONBOARDING_APPLICATION,
  SCHEDULING_APPLICATION,
  SERVICE_EVIDENCE_APPLICATION,
  UNIT_OF_WORK,
  VISIT_EXECUTION_APPLICATION,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import type { BenefitsApplicationService } from '@care/benefits';
import type { BillingApplicationService, BillingClaimsApplicationService } from '@care/billing';
import type { CareDocumentationApplicationService } from '@care/care-documentation';
import type { UnitOfWork } from '@care/database';
import type { OnboardingApplicationService } from '@care/onboarding';
import {
  createOperationsApplicationService,
  OperationsRecurrenceApplicationService,
} from '@care/operations';
import type { OutboxWriter } from '@care/platform';
import type { SchedulingApplicationService } from '@care/scheduling';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import type { VisitExecutionApplicationService } from '@care/visit-execution';

import { AuditModule } from './audit.module';
import { BenefitsModule } from './benefits.module';
import { BillingModule } from './billing.module';
import { CareDocumentationModule } from './care-documentation.module';
import { IdentityModule } from './identity.module';
import { OnboardingModule } from './onboarding.module';
import { PlatformModule } from './platform.module';
import { SchedulingModule } from './scheduling.module';
import { ServiceEvidenceModule } from './service-evidence.module';
import { VisitExecutionModule } from './visit-execution.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    SchedulingModule,
    CareDocumentationModule,
    ServiceEvidenceModule,
    BenefitsModule,
    BillingModule,
    OnboardingModule,
    VisitExecutionModule,
  ],
  controllers: [OperationsController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: OPERATIONS_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SCHEDULING_APPLICATION,
        CARE_DOCUMENTATION_APPLICATION,
        SERVICE_EVIDENCE_APPLICATION,
        BENEFITS_APPLICATION,
        BILLING_APPLICATION,
        BILLING_CLAIMS_APPLICATION,
        ONBOARDING_APPLICATION,
        VISIT_EXECUTION_APPLICATION,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        scheduling: SchedulingApplicationService,
        documentation: CareDocumentationApplicationService,
        evidence: ServiceEvidenceApplicationService,
        benefits: BenefitsApplicationService,
        billing: BillingApplicationService,
        claims: BillingClaimsApplicationService,
        onboarding: OnboardingApplicationService,
        execution: VisitExecutionApplicationService,
      ) =>
        createOperationsApplicationService(unitOfWork, audit, outbox, {
          scheduling,
          documentation,
          evidence,
          benefits,
          billing,
          claims,
          onboarding,
          execution,
        }),
    },
    {
      provide: OPERATIONS_RECURRENCE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new OperationsRecurrenceApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [OPERATIONS_APPLICATION, OPERATIONS_RECURRENCE_APPLICATION],
})
export class OperationsModule {}
