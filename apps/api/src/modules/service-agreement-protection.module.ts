import { Module } from '@nestjs/common';
import { createServiceAgreementGuards } from '@care/service-agreements';
import { SERVICE_AGREEMENT_GUARDS } from '../tokens';

@Module({
  providers: [{ provide: SERVICE_AGREEMENT_GUARDS, useFactory: createServiceAgreementGuards }],
  exports: [SERVICE_AGREEMENT_GUARDS],
})
export class ServiceAgreementProtectionModule {}
