import { Module } from '@nestjs/common';
import { createOperationsApplicationService } from '@care/operations';
import type { AuditWriter } from '@care/audit';
import type { BenefitsApplicationService } from '@care/benefits';
import type { BillingApplicationService, BillingClaimsApplicationService } from '@care/billing';
import type { CareDocumentationApplicationService } from '@care/care-documentation';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { OnboardingApplicationService } from '@care/onboarding';
import type { SchedulingApplicationService } from '@care/scheduling';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import { DatabaseModule } from '@app/api/database/database.module';
import {
  AUDIT_WRITER,
  BENEFITS_APPLICATION,
  BILLING_APPLICATION,
  BILLING_CLAIMS_APPLICATION,
  CARE_DOCUMENTATION_APPLICATION,
  OPERATIONS_APPLICATION,
  OUTBOX_WRITER,
  ONBOARDING_APPLICATION,
  SCHEDULING_APPLICATION,
  SERVICE_EVIDENCE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { OperationsController } from '@app/api/presentation/http/operations.controller';
import { AuditModule } from './audit.module';
import { BenefitsModule } from './benefits.module';
import { BillingModule } from './billing.module';
import { CareDocumentationModule } from './care-documentation.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { SchedulingModule } from './scheduling.module';
import { ServiceEvidenceModule } from './service-evidence.module';
import { OnboardingModule } from './onboarding.module';

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
      ) =>
        createOperationsApplicationService(unitOfWork, audit, outbox, {
          scheduling,
          documentation,
          evidence,
          benefits,
          billing,
          claims,
          onboarding,
        }),
    },
  ],
  exports: [OPERATIONS_APPLICATION],
})
export class OperationsModule {}
