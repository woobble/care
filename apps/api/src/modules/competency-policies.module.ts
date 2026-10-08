import { Module } from '@nestjs/common';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import { ProfessionalCompetencyPolicyApplicationService } from '@care/competency-policies';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  COMPETENCY_POLICY_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { CompetencyPoliciesController } from '../presentation/http/competency-policies.controller';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [CompetencyPoliciesController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: COMPETENCY_POLICY_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        new ProfessionalCompetencyPolicyApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [COMPETENCY_POLICY_APPLICATION],
})
export class CompetencyPoliciesModule {}
