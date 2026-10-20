import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { BillingController } from '@app/api/presentation/http/billing.controller';
import { ClaimsController } from '@app/api/presentation/http/claims.controller';
import {
  CLIENT_APPLICATION,
  AUDIT_WRITER,
  BENEFITS_APPLICATION,
  BILLING_APPLICATION,
  BILLING_CLAIMS_APPLICATION,
  DOCUMENTS_APPLICATION,
  OBJECT_STORAGE,
  OUTBOX_WRITER,
  SERVICE_EVIDENCE_APPLICATION,
  SERVICE_PRICE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';

import type { AuditWriter } from '@care/audit';
import type { BenefitsApplicationService } from '@care/benefits';
import {
  PayerArrangementExpiryQueries,
  createBillingApplicationService,
  createBillingClaimsApplicationService,
} from '@care/billing';
import type { ClientApplicationService } from '@care/clients';
import type { UnitOfWork } from '@care/database';
import type { DocumentsApplicationService } from '@care/documents';
import type { OutboxWriter } from '@care/platform';
import type { ServiceEvidenceApplicationService } from '@care/service-evidence';
import { ServicePriceApplicationService } from '@care/services';
import type { ObjectStorage } from '@care/storage';

import { AuditModule } from './audit.module';
import { BenefitsModule } from './benefits.module';
import { ClientsModule } from './clients.module';
import { DocumentsModule } from './documents.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServiceEvidenceModule } from './service-evidence.module';
import { ServicesModule } from './services.module';

@Module({
  imports: [
    ClientsModule,
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServicesModule,
    BenefitsModule,
    ServiceEvidenceModule,
    DocumentsModule,
  ],
  controllers: [BillingController, ClaimsController],
  providers: [
    {
      provide: PayerArrangementExpiryQueries,
      inject: [UNIT_OF_WORK, CLIENT_APPLICATION],
      useFactory: (unitOfWork: UnitOfWork, clients: ClientApplicationService) =>
        new PayerArrangementExpiryQueries(unitOfWork, clients),
    },
    OidcGuard,
    TenantContextGuard,
    {
      provide: BILLING_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        OBJECT_STORAGE,
        SERVICE_PRICE_APPLICATION,
        BENEFITS_APPLICATION,
        SERVICE_EVIDENCE_APPLICATION,
        DOCUMENTS_APPLICATION,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        storage: ObjectStorage,
        prices: ServicePriceApplicationService,
        benefits: BenefitsApplicationService,
        evidence: ServiceEvidenceApplicationService,
        documents: DocumentsApplicationService,
      ) =>
        createBillingApplicationService(
          unitOfWork,
          audit,
          outbox,
          storage,
          prices,
          benefits,
          evidence,
          documents,
        ),
    },
    {
      provide: BILLING_CLAIMS_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SERVICE_EVIDENCE_APPLICATION,
        DOCUMENTS_APPLICATION,
        OBJECT_STORAGE,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        evidence: ServiceEvidenceApplicationService,
        documents: DocumentsApplicationService,
        storage: ObjectStorage,
      ) =>
        createBillingClaimsApplicationService(
          unitOfWork,
          audit,
          outbox,
          evidence,
          documents,
          storage,
        ),
    },
  ],
  exports: [PayerArrangementExpiryQueries, BILLING_APPLICATION, BILLING_CLAIMS_APPLICATION],
})
export class BillingModule {}
