import { Module } from '@nestjs/common';
import { AuditModule } from './audit.module';
import { IdentityModule } from './identity.module';
import { AuditController } from '@app/api/presentation/http/audit.controller';

@Module({
  imports: [AuditModule, IdentityModule],
  controllers: [AuditController],
})
export class AuditQueryModule {}
