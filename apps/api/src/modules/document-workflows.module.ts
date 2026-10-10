import { Module } from '@nestjs/common';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { DocumentsController } from '../presentation/http/documents.controller';
import { BenefitsModule } from './benefits.module';
import { BillingModule } from './billing.module';
import { ClientsModule } from './clients.module';
import { DocumentsModule } from './documents.module';
import { IdentityModule } from './identity.module';
import { OrganizationsModule } from './organizations.module';
import { SchedulingModule } from './scheduling.module';
import { ServiceAgreementsModule } from './service-agreements.module';
import { ServiceEvidenceModule } from './service-evidence.module';

@Module({
  imports: [
    DocumentsModule,
    ServiceEvidenceModule,
    ServiceAgreementsModule,
    BenefitsModule,
    BillingModule,
    ClientsModule,
    OrganizationsModule,
    SchedulingModule,
    IdentityModule,
  ],
  controllers: [DocumentsController],
  providers: [OidcGuard, TenantContextGuard],
})
export class DocumentWorkflowsModule {}
