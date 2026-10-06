import { Module } from '@nestjs/common';
import { IdentityService } from '@care/identity';
import { DATABASE, IDENTITY_SERVICE } from '../tokens';
import { DatabaseModule } from '../database/database.module';
import type { AppDatabase } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: IDENTITY_SERVICE,
      inject: [DATABASE],
      useFactory: (database: AppDatabase) => new IdentityService(database.db),
    },
  ],
  exports: [IDENTITY_SERVICE],
})
export class IdentityModule {}
