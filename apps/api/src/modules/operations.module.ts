import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { OperationsController } from '@app/api/presentation/http/operations.controller';
import {
  ORGANIZATION_APPLICATION,
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
import { BenefitEntitlementExpiryQueries, type BenefitsApplicationService } from '@care/benefits';
import {
  PayerArrangementExpiryQueries,
  type BillingApplicationService,
  type BillingClaimsApplicationService,
} from '@care/billing';
import type { CareDocumentationApplicationService } from '@care/care-documentation';
import type { UnitOfWork } from '@care/database';
import { QualificationExpiryQueries } from '@care/employees';
import type { OnboardingApplicationService } from '@care/onboarding';
import {
  createOperationsApplicationService,
  OperationsRecurrenceApplicationService,
} from '@care/operations';
import type { OrganizationApplicationService } from '@care/organizations';
import type { OutboxWriter } from '@care/platform';
import type { SchedulingApplicationService } from '@care/scheduling';
import { AgreementExpiryQueries } from '@care/service-agreements';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import type { VisitExecutionApplicationService } from '@care/visit-execution';

import { AuditModule } from './audit.module';
import { BenefitsModule } from './benefits.module';
import { BillingModule } from './billing.module';
import { CareDocumentationModule } from './care-documentation.module';
import { EmployeesModule } from './employees.module';
import { IdentityModule } from './identity.module';
import { OnboardingModule } from './onboarding.module';
import { OrganizationsModule } from './organizations.module';
import { PlatformModule } from './platform.module';
import { SchedulingModule } from './scheduling.module';
import { ServiceAgreementsModule } from './service-agreements.module';
import { ServiceEvidenceModule } from './service-evidence.module';
import { VisitExecutionModule } from './visit-execution.module';

@Module({
  imports: [
    OrganizationsModule,
    EmployeesModule,
    ServiceAgreementsModule,
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
        AgreementExpiryQueries,
        QualificationExpiryQueries,
        BenefitEntitlementExpiryQueries,
        PayerArrangementExpiryQueries,
        ORGANIZATION_APPLICATION,
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
        agreements: AgreementExpiryQueries,
        qualifications: QualificationExpiryQueries,
        benefitExpiry: BenefitEntitlementExpiryQueries,
        payerExpiry: PayerArrangementExpiryQueries,
        organizations: OrganizationApplicationService,
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
          agreements,
          qualifications,
          benefitExpiry,
          payerExpiry,
          organizations,
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
