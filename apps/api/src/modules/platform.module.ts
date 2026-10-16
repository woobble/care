import { Module } from '@nestjs/common';

import { DatabaseModule } from '@app/api/database/database.module';
import type { AppDatabase } from '@app/api/database/database.module';
import { DATABASE, OUTBOX_WRITER } from '@app/api/tokens';
import { DrizzleOutboxRepository } from '@care/platform';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: OUTBOX_WRITER,
      inject: [DATABASE],
      useFactory: (database: AppDatabase) => new DrizzleOutboxRepository(database.db),
    },
  ],
  exports: [OUTBOX_WRITER],
})
export class PlatformModule {}
