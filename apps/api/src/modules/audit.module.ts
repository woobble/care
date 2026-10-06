import { Module } from '@nestjs/common';
import { DrizzleAuditReader, DrizzleAuditWriter } from '@care/audit';
import type { UnitOfWork } from '@care/database';
import { AUDIT_READER, AUDIT_WRITER, UNIT_OF_WORK } from '../tokens';

@Module({
  providers: [
    { provide: AUDIT_WRITER, useFactory: () => new DrizzleAuditWriter() },
    {
      provide: AUDIT_READER,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new DrizzleAuditReader(unitOfWork),
    },
  ],
  exports: [AUDIT_WRITER, AUDIT_READER],
})
export class AuditModule {}
