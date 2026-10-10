import { Module } from '@nestjs/common';
import {
  createDocumentsApplicationService,
  type DocumentsApplicationService,
} from '@care/documents';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import type { ObjectStorage } from '@care/storage';
import { DatabaseModule } from '@app/api/database/database.module';
import {
  AUDIT_WRITER,
  DOCUMENTS_APPLICATION,
  OBJECT_STORAGE,
  OUTBOX_WRITER,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import { AuditModule } from './audit.module';
import { PlatformModule } from './platform.module';
import { ServiceEvidenceModule } from './service-evidence.module';

@Module({
  imports: [DatabaseModule, AuditModule, PlatformModule, ServiceEvidenceModule],
  providers: [
    {
      provide: DOCUMENTS_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER, OBJECT_STORAGE],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        storage: ObjectStorage,
      ): DocumentsApplicationService =>
        createDocumentsApplicationService(unitOfWork, audit, outbox, storage),
    },
  ],
  exports: [DOCUMENTS_APPLICATION],
})
export class DocumentsModule {}
