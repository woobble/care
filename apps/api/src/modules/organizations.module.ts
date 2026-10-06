import { Module } from '@nestjs/common';
import { OrganizationApplicationService } from '@care/organizations';
import type { UnitOfWork } from '@care/database';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from './identity.module';
import { OrganizationsController } from '../presentation/http/organizations.controller';
import { ORGANIZATION_APPLICATION, UNIT_OF_WORK } from '../tokens';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [OrganizationsController],
  providers: [
    {
      provide: ORGANIZATION_APPLICATION,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new OrganizationApplicationService(unitOfWork),
    },
  ],
})
export class OrganizationsModule {}
