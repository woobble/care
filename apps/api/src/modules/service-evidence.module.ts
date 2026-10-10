import { Module } from '@nestjs/common';
import {
  createServiceEvidenceApplicationService,
  type ServiceEvidenceApplicationService,
} from '@care/service-evidence';
import { createS3ObjectStorage } from '@care/storage';
import type { AuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import type { OutboxWriter } from '@care/platform';
import { loadStorageConfig } from '@care/config';
import { DatabaseModule } from '@app/api/database/database.module';
import { OidcGuard, TenantContextGuard } from '@app/api/http/auth.guards';
import { ServiceEvidenceController } from '@app/api/presentation/http/service-evidence.controller';
import {
  AUDIT_WRITER,
  OBJECT_STORAGE,
  OUTBOX_WRITER,
  SERVICE_EVIDENCE_APPLICATION,
  UNIT_OF_WORK,
} from '@app/api/tokens';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [ServiceEvidenceController],
  providers: [
    OidcGuard,
    TenantContextGuard,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => {
        const config = loadStorageConfig();
        return createS3ObjectStorage({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET,
          accessKey: config.S3_ACCESS_KEY,
          secretKey: config.S3_SECRET_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        });
      },
    },
    {
      provide: SERVICE_EVIDENCE_APPLICATION,
      inject: [UNIT_OF_WORK, AUDIT_WRITER, OUTBOX_WRITER, OBJECT_STORAGE],
      useFactory: (
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        outbox: OutboxWriter,
        storage: Parameters<typeof createServiceEvidenceApplicationService>[3],
      ): ServiceEvidenceApplicationService =>
        createServiceEvidenceApplicationService(unitOfWork, audit, outbox, storage),
    },
  ],
  exports: [SERVICE_EVIDENCE_APPLICATION, OBJECT_STORAGE],
})
export class ServiceEvidenceModule {}
