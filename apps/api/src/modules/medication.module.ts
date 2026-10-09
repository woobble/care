import { Module } from '@nestjs/common';
import type { AuditWriter } from '@care/audit';
import type { CompetencyPolicyEvaluator } from '@care/permissions';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import { MedicationApplicationService } from '@care/medication';
import type { OutboxWriter } from '@care/platform';
import { DatabaseModule } from '../database/database.module';
import {
  AUDIT_WRITER,
  COMPETENCY_POLICY_APPLICATION,
  MEDICATION_APPLICATION,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '../tokens';
import { OidcGuard, TenantContextGuard } from '../http/auth.guards';
import { MedicationController } from '../presentation/http/medication.controller';
import { AuditModule } from './audit.module';
import { CompetencyPoliciesModule } from './competency-policies.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule, CompetencyPoliciesModule],
  controllers: [MedicationController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: MEDICATION_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER, COMPETENCY_POLICY_APPLICATION],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        competency: CompetencyPolicyEvaluator<DatabaseTransaction>,
      ) => new MedicationApplicationService(unitOfWork, audit, outbox, competency),
    },
  ],
})
export class MedicationModule {}
