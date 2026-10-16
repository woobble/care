import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { ClientMasterDataController } from '@app/api/presentation/http/client-master-data.controller';
import { ClientsController } from '@app/api/presentation/http/clients.controller';
import {
  AUDIT_WRITER,
  CLIENT_APPLICATION,
  CLIENT_MASTER_DATA_APPLICATION,
  OUTBOX_WRITER,
  SERVICE_AGREEMENT_GUARDS,
  SCHEDULING_GUARDS,
  VISIT_EXECUTION_GUARDS,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import type { AuditWriter } from '@care/audit';
import {
  createClientApplicationService,
  createClientMasterDataApplicationService,
  type ClientSchedulingGuard,
} from '@care/clients';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { ServiceAgreementGuards } from '@care/service-agreements';
import type { VisitExecutionGuards } from '@care/visit-execution';

import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';
import { ServiceAgreementProtectionModule } from './service-agreement-protection.module';
import { VisitExecutionModule } from './visit-execution.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AuditModule,
    PlatformModule,
    ServiceAgreementProtectionModule,
    VisitExecutionModule,
  ],
  controllers: [ClientsController, ClientMasterDataController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: CLIENT_APPLICATION,
      inject: [
        UNIT_OF_WORK,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        SERVICE_AGREEMENT_GUARDS,
        SCHEDULING_GUARDS,
        VISIT_EXECUTION_GUARDS,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        guards: ServiceAgreementGuards,
        scheduling: ClientSchedulingGuard,
        execution: VisitExecutionGuards,
      ) => createClientApplicationService(unitOfWork, audit, outbox, guards, scheduling, execution),
    },
    {
      provide: CLIENT_MASTER_DATA_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER],
      useFactory: (unitOfWork: UnitOfWork, audit: AuditWriter, outbox: OutboxWriter) =>
        createClientMasterDataApplicationService(unitOfWork, audit, outbox),
    },
  ],
  exports: [CLIENT_APPLICATION, CLIENT_MASTER_DATA_APPLICATION],
})
export class ClientsModule {}
