import { Module } from '@nestjs/common';
import { DrizzleAuditWriter } from '@care/audit';
import { AUDIT_WRITER } from '../tokens';

@Module({
  providers: [{ provide: AUDIT_WRITER, useFactory: () => new DrizzleAuditWriter() }],
  exports: [AUDIT_WRITER],
})
export class AuditModule {}
