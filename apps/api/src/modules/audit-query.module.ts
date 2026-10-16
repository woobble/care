import { Module } from '@nestjs/common';

import { AuditController } from '@app/api/presentation/http/audit.controller';

import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';

@Module({
  imports: [AuditModule, IdentityModule],
  controllers: [AuditController],
})
export class AuditQueryModule {}
