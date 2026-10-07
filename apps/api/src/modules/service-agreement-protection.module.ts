import { Module } from '@nestjs/common';
import { createServiceAgreementGuards } from '@care/service-agreements';
import { createSchedulingGuards } from '@care/scheduling';
import { SCHEDULING_GUARDS, SERVICE_AGREEMENT_GUARDS } from '../tokens';

@Module({
  providers: [
    { provide: SCHEDULING_GUARDS, useFactory: createSchedulingGuards },
    {
      provide: SERVICE_AGREEMENT_GUARDS,
      useFactory: () => {
        const agreements = createServiceAgreementGuards();
        const scheduling = createSchedulingGuards();
        return {
          hasActiveForClient: agreements.hasActiveForClient.bind(agreements),
          hasActiveForOrganization: agreements.hasActiveForOrganization.bind(agreements),
          hasActiveForFacility: agreements.hasActiveForFacility.bind(agreements),
          hasActiveForService: agreements.hasActiveForService.bind(agreements),
          hasFutureVisitsForAgreement: scheduling.hasFutureVisitsForAgreement.bind(scheduling),
          hasFutureVisitsOutsideAgreementValidity:
            scheduling.hasFutureVisitsOutsideAgreementValidity.bind(scheduling),
          hasFutureVisitsForAgreementService:
            scheduling.hasFutureVisitsForAgreementService.bind(scheduling),
          hasFutureVisitsOutsideAgreementServiceValidity:
            scheduling.hasFutureVisitsOutsideAgreementServiceValidity.bind(scheduling),
        };
      },
    },
  ],
  exports: [SERVICE_AGREEMENT_GUARDS, SCHEDULING_GUARDS],
})
export class ServiceAgreementProtectionModule {}
